import { runAudit } from "@/lib/audit";
import { compareAudits } from "@/lib/audit-comparison";
import type { AuditResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
type Config = { url: string; key: string };
function config(): Config | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function headers(key: string, prefer?: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function recordFailureAlert(value: Config, monitor: { id: string; owner_id: string; project_id: string }): Promise<boolean> {
  const fingerprint = `failure:${monitor.project_id}`;
  try {
    const existingResponse = await fetch(
      `${value.url}/rest/v1/monitoring_alerts?select=id&owner_id=eq.${encodeURIComponent(monitor.owner_id)}&project_id=eq.${encodeURIComponent(monitor.project_id)}&alert_fingerprint=eq.${encodeURIComponent(fingerprint)}&status=neq.resolved&limit=1`,
      { headers: headers(value.key), cache: "no-store" },
    );
    if (!existingResponse.ok) return false;
    const existing = (await existingResponse.json() as Array<{ id: string }>)[0];
    const details = {
      audit_id: `failure:${monitor.id}:${Date.now()}`,
      severity: "high",
      summary: { reason: "scheduled_audit_failed", failedAt: new Date().toISOString() },
    };
    const response = await fetch(
      existing
        ? `${value.url}/rest/v1/monitoring_alerts?id=eq.${encodeURIComponent(existing.id)}&owner_id=eq.${encodeURIComponent(monitor.owner_id)}`
        : `${value.url}/rest/v1/monitoring_alerts`,
      {
        method: existing ? "PATCH" : "POST",
        headers: headers(value.key),
        body: JSON.stringify(existing ? details : {
          owner_id: monitor.owner_id,
          project_id: monitor.project_id,
          kind: "failure",
          alert_fingerprint: fingerprint,
          status: "open",
          ...details,
        }),
        cache: "no-store",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (
    !expected ||
    request.headers.get("authorization") !== `Bearer ${expected}`
  )
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  const value = config();
  if (!value)
    return Response.json(
      { error: "Monitoring service is not configured." },
      { status: 503 },
    );
  const dueResponse = await fetch(
    `${value.url}/rest/v1/monitoring_configs?select=id,owner_id,project_id,cadence,next_run_at&enabled=eq.true&next_run_at=lte.${encodeURIComponent(new Date().toISOString())}&order=next_run_at.asc&limit=5`,
    { headers: headers(value.key), cache: "no-store" },
  );
  if (!dueResponse.ok)
    return Response.json(
      { error: "Unable to load due monitors." },
      { status: 502 },
    );
  const due = (await dueResponse.json()) as Array<{
    id: string;
    owner_id: string;
    project_id: string;
    cadence: "daily" | "weekly";
    next_run_at: string;
  }>;
  const results: Array<{
    monitorId: string;
    status: string;
    auditId?: string;
    alertRecorded?: boolean;
    retryScheduled?: boolean;
  }> = [];
  for (const monitor of due) {
    const projectResponse = await fetch(
      `${value.url}/rest/v1/projects?select=domain,verified_at&id=eq.${encodeURIComponent(monitor.project_id)}&limit=1`,
      { headers: headers(value.key), cache: "no-store" },
    );
    const project = projectResponse.ok
      ? ((await projectResponse.json()) as Array<{ domain: string; verified_at: string | null }>)[0]
      : null;
    if (!project) {
      results.push({ monitorId: monitor.id, status: "project_missing" });
      continue;
    }
    if (!project.verified_at) {
      results.push({ monitorId: monitor.id, status: "verification_required" });
      continue;
    }
    // Claim the due row atomically before an outbound crawl. Concurrent cron calls
    // cannot both claim the same next_run_at value. Never crawl a disabled monitor.
    const next = new Date(
      Date.now() + (monitor.cadence === "daily" ? 86400000 : 604800000),
    ).toISOString();
    let claimResponse: Response;
    try {
      claimResponse = await fetch(
        `${value.url}/rest/v1/monitoring_configs?id=eq.${encodeURIComponent(monitor.id)}&enabled=eq.true&next_run_at=eq.${encodeURIComponent(monitor.next_run_at)}`,
        {
          method: "PATCH",
          headers: headers(value.key, "return=representation"),
          body: JSON.stringify({ next_run_at: next }),
          cache: "no-store",
        },
      );
    } catch {
      results.push({ monitorId: monitor.id, status: "claim_failed" });
      continue;
    }
    if (!claimResponse.ok) {
      results.push({ monitorId: monitor.id, status: "claim_failed" });
      continue;
    }
    const claimed = (await claimResponse.json()) as Array<{ id: string }>;
    if (!claimed.length) {
      results.push({ monitorId: monitor.id, status: "already_claimed" });
      continue;
    }
    try {
      const previousResponse = await fetch(
        `${value.url}/rest/v1/audit_runs?select=result&owner_id=eq.${encodeURIComponent(monitor.owner_id)}&project_id=eq.${encodeURIComponent(monitor.project_id)}&order=created_at.desc&limit=1`,
        { headers: headers(value.key), cache: "no-store" },
      );
      if (!previousResponse.ok) throw new Error("Unable to load previous audit.");
      const previousRows = (await previousResponse.json()) as Array<{
        result: AuditResult | null;
      }>;
      const previous = previousRows[0]?.result;
      const audit = await runAudit(`https://${project.domain}`, {
        maxPages: 20,
        maxDepth: 3,
        concurrency: 4,
        respectRobots: true,
        checkExternalLinks: true,
        deadlineMs: 50000,
      });
      const saveResponse = await fetch(`${value.url}/rest/v1/audit_runs`, {
        method: "POST",
        headers: headers(value.key),
        body: JSON.stringify({
          owner_id: monitor.owner_id,
          project_id: monitor.project_id,
          url: `https://${project.domain}`,
          audit_id: audit.auditId,
          engine_version: audit.version,
          status: audit.crawl.truncated ? "truncated" : "completed",
          summary: {
            pagesCrawled: audit.crawl.pagesCrawled,
            findings: audit.findings.length,
            opportunities: audit.opportunities.length,
            healthScore: audit.health.overall,
            source: "scheduled_monitoring",
          },
          result: audit,
          completed_at: new Date().toISOString(),
        }),
        cache: "no-store",
      });
      if (!saveResponse.ok) throw new Error("Unable to persist scheduled audit.");
      if (previous) {
        const comparison = compareAudits(previous, audit);
        if (comparison.regressions.length) {
          const fingerprint = `regression:${monitor.project_id}:${comparison.regressions
            .map((finding) => finding.ruleId)
            .sort()
            .join("|")}`;
          const existingResponse = await fetch(
            `${value.url}/rest/v1/monitoring_alerts?select=id&owner_id=eq.${encodeURIComponent(monitor.owner_id)}&project_id=eq.${encodeURIComponent(monitor.project_id)}&alert_fingerprint=eq.${encodeURIComponent(fingerprint)}&status=neq.resolved&limit=1`,
            { headers: headers(value.key), cache: "no-store" },
          );
          if (!existingResponse.ok) throw new Error("Unable to check existing regression alert.");
          const existing = (await existingResponse.json() as Array<{ id: string }>)[0];
          const details = {
            audit_id: audit.auditId,
            severity: comparison.regressions.some(
              (finding) => finding.severity === "critical",
            ) ? "critical" : "high",
            summary: {
              regressions: comparison.regressions.length,
              newFindings: comparison.newFindings.length,
              healthScoreDelta: comparison.healthScoreDelta,
            },
          };
          const alertResponse = await fetch(
            existing
              ? `${value.url}/rest/v1/monitoring_alerts?id=eq.${encodeURIComponent(existing.id)}&owner_id=eq.${encodeURIComponent(monitor.owner_id)}`
              : `${value.url}/rest/v1/monitoring_alerts`,
            {
              method: existing ? "PATCH" : "POST",
              headers: headers(value.key),
              body: JSON.stringify(existing ? details : {
                owner_id: monitor.owner_id,
                project_id: monitor.project_id,
                kind: "regression",
                alert_fingerprint: fingerprint,
                status: "open",
                ...details,
              }),
              cache: "no-store",
            },
          );
          if (!alertResponse.ok) throw new Error("Unable to persist regression alert.");
        }
      }
      const completeResponse = await fetch(
        `${value.url}/rest/v1/monitoring_configs?id=eq.${encodeURIComponent(monitor.id)}&next_run_at=eq.${encodeURIComponent(next)}`,
        {
          method: "PATCH",
          headers: headers(value.key, "return=representation"),
          body: JSON.stringify({ last_run_at: new Date().toISOString() }),
          cache: "no-store",
        },
      );
      if (!completeResponse.ok || !(await completeResponse.json() as Array<{ id: string }>).length)
        throw new Error("Unable to mark scheduled audit complete.");
      results.push({
        monitorId: monitor.id,
        status: "completed",
        auditId: audit.auditId,
      });
    } catch {
      const alertRecorded = await recordFailureAlert(value, monitor);
      // Retry failed runs shortly, but only if this invocation still owns the claim.
      const retryResponse = await fetch(
        `${value.url}/rest/v1/monitoring_configs?id=eq.${encodeURIComponent(monitor.id)}&next_run_at=eq.${encodeURIComponent(next)}`,
        {
          method: "PATCH",
          headers: headers(value.key, "return=representation"),
          body: JSON.stringify({ next_run_at: new Date(Date.now() + 900000).toISOString() }),
          cache: "no-store",
        },
      ).catch(() => null);
      results.push({
        monitorId: monitor.id,
        status: "failed",
        alertRecorded,
        retryScheduled: !!retryResponse?.ok && (await retryResponse.json() as Array<{ id: string }>).length > 0,
      });
    }
  }
  return Response.json({ processed: results.length, results });
}

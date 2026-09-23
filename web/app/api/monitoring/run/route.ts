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
    `${value.url}/rest/v1/monitoring_configs?select=id,owner_id,project_id,cadence&enabled=eq.true&next_run_at=lte.${encodeURIComponent(new Date().toISOString())}&order=next_run_at.asc&limit=5`,
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
  }>;
  const results: Array<{
    monitorId: string;
    status: string;
    auditId?: string;
  }> = [];
  for (const monitor of due) {
    const projectResponse = await fetch(
      `${value.url}/rest/v1/projects?select=domain&id=eq.${encodeURIComponent(monitor.project_id)}&limit=1`,
      { headers: headers(value.key), cache: "no-store" },
    );
    const project = projectResponse.ok
      ? ((await projectResponse.json()) as Array<{ domain: string }>)[0]
      : null;
    if (!project) {
      results.push({ monitorId: monitor.id, status: "project_missing" });
      continue;
    }
    try {
      const previousResponse = await fetch(
        `${value.url}/rest/v1/audit_runs?select=result&owner_id=eq.${encodeURIComponent(monitor.owner_id)}&project_id=eq.${encodeURIComponent(monitor.project_id)}&order=created_at.desc&limit=1`,
        { headers: headers(value.key), cache: "no-store" },
      );
      const previousRows = previousResponse.ok
        ? ((await previousResponse.json()) as Array<{
            result: AuditResult | null;
          }>)
        : [];
      const previous = previousRows[0]?.result;
      const audit = await runAudit(`https://${project.domain}`, {
        maxPages: 20,
        maxDepth: 3,
        concurrency: 4,
        respectRobots: true,
        checkExternalLinks: true,
        deadlineMs: 50000,
      });
      await fetch(`${value.url}/rest/v1/audit_runs`, {
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
      if (previous) {
        const comparison = compareAudits(previous, audit);
        if (comparison.regressions.length)
          await fetch(`${value.url}/rest/v1/monitoring_alerts`, {
            method: "POST",
            headers: headers(value.key, "resolution=merge-duplicates"),
            body: JSON.stringify({
              owner_id: monitor.owner_id,
              project_id: monitor.project_id,
              audit_id: audit.auditId,
              kind: "regression",
              alert_fingerprint: `regression:${monitor.project_id}:${comparison.regressions
                .map((finding) => finding.ruleId)
                .sort()
                .join("|")}`,
              severity: comparison.regressions.some(
                (finding) => finding.severity === "critical",
              )
                ? "critical"
                : "high",
              summary: {
                regressions: comparison.regressions.length,
                newFindings: comparison.newFindings.length,
                healthScoreDelta: comparison.healthScoreDelta,
              },
              status: "open",
            }),
            cache: "no-store",
          });
      }
      const next = new Date(
        Date.now() + (monitor.cadence === "daily" ? 86400000 : 604800000),
      ).toISOString();
      await fetch(
        `${value.url}/rest/v1/monitoring_configs?id=eq.${encodeURIComponent(monitor.id)}`,
        {
          method: "PATCH",
          headers: headers(value.key),
          body: JSON.stringify({
            last_run_at: new Date().toISOString(),
            next_run_at: next,
          }),
          cache: "no-store",
        },
      );
      results.push({
        monitorId: monitor.id,
        status: "completed",
        auditId: audit.auditId,
      });
    } catch {
      results.push({ monitorId: monitor.id, status: "failed" });
    }
  }
  return Response.json({ processed: results.length, results });
}

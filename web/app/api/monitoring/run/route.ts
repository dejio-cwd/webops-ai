import { launchAudit } from "@/lib/pipeline/launch";

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
      const id = await launchAudit(monitor.owner_id, {
        url: `https://${project.domain}`, projectId: monitor.project_id,
        config: { maxPages: 20, maxDepth: 3, concurrency: 4, respectRobots: true, checkExternalLinks: true },
      }, { id: monitor.id, claim: next });
      results.push({ monitorId: monitor.id, status: "queued", auditId: id });
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

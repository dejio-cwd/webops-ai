import { runAudit, AUDIT_ENGINE_VERSION } from "@/lib/audit";
import { verificationCoverage } from "@/lib/fix-verification";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

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

async function projectRole(value: Config, projectId: string, actorId: string): Promise<string | null> {
  const projectResponse = await fetch(
    `${value.url}/rest/v1/projects?select=id,owner_id,organization_id&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const projects = projectResponse.ok
    ? ((await projectResponse.json()) as Array<{ id: string; owner_id: string; organization_id: string | null }>)
    : [];
  const project = projects[0];
  if (!project) return null;
  if (project.owner_id === actorId) return "owner";
  if (!project.organization_id) return null;
  const memberResponse = await fetch(
    `${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(project.organization_id)}&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const members = memberResponse.ok ? ((await memberResponse.json()) as Array<{ role: string }>) : [];
  return members[0]?.role || null;
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "fixes-verify",
    limit: 10,
    windowMs: 300_000,
    maxBodyBytes: 8_000,
    requireAuth: true,
  });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const value = config();
  if (!value)
    return Response.json({ error: "Fix verification service is not configured." }, { status: 503 });

  let body: { auditId?: string; projectId?: string; opportunityId?: string; verificationNote?: string; rollbackPlan?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const auditId = (body.auditId || "").trim();
  const opportunityId = (body.opportunityId || "").trim();
  const projectId = (body.projectId || "").trim();
  if (!auditId || !opportunityId)
    return Response.json({ error: "Audit and opportunity are required." }, { status: 400 });

  if (projectId && !["owner", "admin", "developer"].includes((await projectRole(value, projectId, actor.id)) || ""))
    return Response.json({ error: "Fix Center access denied for this project." }, { status: 403 });

  // Validate the baseline audit belongs to this scope before trusting its evidence.
  const baselineResponse = await fetch(
    `${value.url}/rest/v1/audit_runs?select=owner_id,project_id,url,created_at,status,result&audit_id=eq.${encodeURIComponent(auditId)}${projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : `&owner_id=eq.${encodeURIComponent(actor.id)}`}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  if (!baselineResponse.ok)
    return Response.json({ error: "Unable to load the baseline audit." }, { status: 502 });
  const baseline = ((await baselineResponse.json()) as Array<{
    owner_id: string;
    project_id: string | null;
    url: string;
    created_at: string;
    status: string;
    result: { crawl?: { origin?: string; requestedUrl?: string }; opportunities?: Array<{ id: string; affectedUrls: string[] }> } | null;
  }>)[0];
  if (!baseline || baseline.project_id !== (projectId || null) || baseline.status !== "completed" || !baseline.result)
    return Response.json({ error: "Audit is not available in this project." }, { status: 403 });
  if (!baseline.result.opportunities?.some((item) => item.id === opportunityId))
    return Response.json({ error: "Opportunity is not part of this audit." }, { status: 400 });

  // Only a fix that a user has already staged as "ready" can be auto-verified.
  const fixResponse = await fetch(
    `${value.url}/rest/v1/fix_records?select=status,title&owner_id=eq.${encodeURIComponent(baseline.owner_id)}&audit_id=eq.${encodeURIComponent(auditId)}&opportunity_id=eq.${encodeURIComponent(opportunityId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  if (!fixResponse.ok)
    return Response.json({ error: "Unable to load the fix record." }, { status: 502 });
  const fix = ((await fixResponse.json()) as Array<{ status: string; title: string }>)[0];
  if (!fix) return Response.json({ error: "No fix record found. Mark the fix ready first." }, { status: 404 });
  if (fix.status !== "ready")
    return Response.json({ error: "Only fixes marked ready can be verified." }, { status: 409 });

  const target = baseline.result.crawl?.origin || baseline.result.crawl?.requestedUrl || baseline.url;
  if (!target) return Response.json({ error: "The baseline audit has no target URL to re-crawl." }, { status: 400 });

  // Re-crawl the target. runAudit enforces robots.txt and SSRF/private-range blocking.
  let followup;
  try {
    followup = await runAudit(target, {
      maxPages: 40,
      maxDepth: 4,
      concurrency: 6,
      respectRobots: true,
      checkExternalLinks: false,
      deadlineMs: 45_000,
    });
  } catch {
    return Response.json(
      { verified: false, reason: "The re-crawl gathered no evidence. The site's robots policy or network access may block it." },
      { status: 200 },
    );
  }

  // Persist the verification crawl for the audit trail before deciding the outcome.
  const saveResponse = await fetch(`${value.url}/rest/v1/audit_runs`, {
    method: "POST",
    headers: headers(value.key),
    body: JSON.stringify({
      owner_id: baseline.owner_id,
      project_id: baseline.project_id,
      url: target,
      audit_id: followup.auditId,
      engine_version: followup.version || AUDIT_ENGINE_VERSION,
      status: followup.crawl.truncated ? "truncated" : "completed",
      summary: {
        pagesCrawled: followup.crawl.pagesCrawled,
        findings: followup.findings.length,
        opportunities: followup.opportunities.length,
        healthScore: followup.health.overall,
        source: "remediation_verification",
        baselineAuditId: auditId,
        opportunityId,
      },
      result: followup,
      completed_at: new Date().toISOString(),
    }),
    cache: "no-store",
  });
  if (!saveResponse.ok)
    return Response.json({ error: "Unable to persist the verification audit." }, { status: 502 });

  const coverage = verificationCoverage(baseline.result, followup, opportunityId);
  if (!coverage.valid)
    return Response.json({ verified: false, auditId: followup.auditId, reason: coverage.reason }, { status: 200 });

  // Coverage proves every affected URL was recrawled without the finding: mark verified.
  const note =
    `Automatically verified by re-crawl on ${new Date().toISOString()} (follow-up audit ${followup.auditId}). ${coverage.reason}` +
    (body.verificationNote?.trim() ? ` — ${body.verificationNote.trim().slice(0, 1_000)}` : "");
  const rollback =
    body.rollbackPlan?.trim().slice(0, 2_000) ||
    "Revert the change that resolved this finding if a subsequent audit shows it has regressed.";
  const updateResponse = await fetch(
    `${value.url}/rest/v1/fix_records?owner_id=eq.${encodeURIComponent(baseline.owner_id)}&audit_id=eq.${encodeURIComponent(auditId)}&opportunity_id=eq.${encodeURIComponent(opportunityId)}&status=eq.ready`,
    {
      method: "PATCH",
      headers: headers(value.key, "return=representation"),
      body: JSON.stringify({ status: "verified", verification_note: note, rollback_plan: rollback, updated_at: new Date().toISOString() }),
      cache: "no-store",
    },
  );
  if (!updateResponse.ok)
    return Response.json({ error: "Unable to record the verified fix." }, { status: 502 });
  const updated = (await updateResponse.json()) as Array<{ id: string }>;
  if (!updated.length)
    return Response.json({ error: "The fix was no longer in a ready state." }, { status: 409 });

  if (projectId) {
    const projectResponse = await fetch(
      `${value.url}/rest/v1/projects?select=organization_id&id=eq.${encodeURIComponent(projectId)}&limit=1`,
      { headers: headers(value.key), cache: "no-store" },
    );
    const organizationId = projectResponse.ok
      ? ((await projectResponse.json()) as Array<{ organization_id: string | null }>)[0]?.organization_id
      : null;
    if (organizationId)
      await fetch(`${value.url}/rest/v1/audit_events`, {
        method: "POST",
        headers: headers(value.key),
        body: JSON.stringify({
          organization_id: organizationId,
          actor_id: actor.id,
          action: "fix.verified",
          resource_type: "fix_record",
          resource_id: updated[0].id,
          metadata: { auditId, opportunityId, verificationAuditId: followup.auditId, method: "recrawl" },
        }),
        cache: "no-store",
      }).catch(() => null);
  }

  return Response.json({ verified: true, auditId: followup.auditId, reason: coverage.reason });
}

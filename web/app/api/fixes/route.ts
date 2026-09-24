import { verificationCoverage } from "@/lib/fix-verification";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

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

async function projectRole(
  value: Config,
  projectId: string,
  actorId: string,
) {
  const projectResponse = await fetch(
    `${value.url}/rest/v1/projects?select=id,owner_id,organization_id&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const projects = projectResponse.ok
    ? ((await projectResponse.json()) as Array<{
        id: string;
        owner_id: string;
        organization_id: string | null;
      }>)
    : [];
  const project = projects[0];
  if (!project) return null;
  if (project.owner_id === actorId) return "owner";
  if (!project.organization_id) return null;
  const memberResponse = await fetch(
    `${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(project.organization_id)}&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const members = memberResponse.ok
    ? ((await memberResponse.json()) as Array<{ role: string }>)
    : [];
  return members[0]?.role || null;
}

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "fixes-read",
    limit: 60,
    requireAuth: true,
  });
  if (isGuardResponse(actor)) return actor;
  if (!actor)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const value = config();
  if (!value) return Response.json({ fixes: [] });
  const params = new URL(request.url).searchParams;
  const auditId = params.get("auditId") || "";
  const projectId = params.get("projectId") || "";
  if (projectId && !(await projectRole(value, projectId, actor.id)))
    return Response.json({ error: "Project access denied." }, { status: 403 });
  const scope = projectId
    ? `&project_id=eq.${encodeURIComponent(projectId)}`
    : `&owner_id=eq.${encodeURIComponent(actor.id)}`;
  const endpoint = `${value.url}/rest/v1/fix_records?select=id,project_id,audit_id,opportunity_id,status,created_at,updated_at${scope}${auditId ? `&audit_id=eq.${encodeURIComponent(auditId)}` : ""}&order=updated_at.desc&limit=100`;
  const response = await fetch(endpoint, {
    headers: headers(value.key),
    cache: "no-store",
  });
  if (!response.ok)
    return Response.json(
      { error: "Unable to load fix records." },
      { status: 502 },
    );
  return Response.json(
    { fixes: await response.json() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "fixes-write",
    limit: 60,
    windowMs: 300_000,
    maxBodyBytes: 12_000,
    requireAuth: true,
  });
  if (isGuardResponse(actor)) return actor;
  if (!actor)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const value = config();
  if (!value)
    return Response.json(
      { error: "Fix service is not configured." },
      { status: 503 },
    );
  let body: {
    auditId?: string;
    projectId?: string;
    opportunityId?: string;
    title?: string;
    status?: "draft" | "ready" | "verified";
    evidence?: string[];
    recommendation?: string;
    verificationNote?: string;
    rollbackPlan?: string;
    verificationAuditId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (
    body.projectId &&
    !["owner", "admin", "developer"].includes(await projectRole(value, body.projectId, actor.id) || "")
  )
    return Response.json(
      {
        error:
          "Owner, admin, or developer access required for Fix Center changes.",
      },
      { status: 403 },
    );
  if (
    !body.auditId ||
    !body.opportunityId ||
    !body.title ||
    !["draft", "ready", "verified"].includes(body.status || "")
  )
    return Response.json(
      { error: "Audit, opportunity, title, and valid status are required." },
      { status: 400 },
    );
  // The service role bypasses RLS: validate the audit and project association
  // before allowing a write. A supplied project ID alone is not proof of scope.
  const auditScope = body.projectId
    ? `&project_id=eq.${encodeURIComponent(body.projectId)}`
    : `&owner_id=eq.${encodeURIComponent(actor.id)}`;
  const auditResponse = await fetch(
    `${value.url}/rest/v1/audit_runs?select=owner_id,audit_id,project_id,created_at,status,result${auditScope}&audit_id=eq.${encodeURIComponent(body.auditId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  if (!auditResponse.ok)
    return Response.json({ error: "Unable to validate audit scope." }, { status: 502 });
  const baselines = (await auditResponse.json()) as Array<{
    owner_id: string;
    project_id: string | null;
    created_at: string;
    status: string;
    result: { opportunities?: Array<{ id: string; affectedUrls: string[] }> } | null;
  }>;
  const baseline = baselines[0];
  if (!baseline || baseline.project_id !== (body.projectId || null) || baseline.status !== "completed")
    return Response.json({ error: "Audit is not available in this project." }, { status: 403 });
  if (!baseline.result?.opportunities?.some((item) => item.id === body.opportunityId))
    return Response.json({ error: "Opportunity is not part of this audit." }, { status: 400 });
  if (body.status === "verified") {
    if (!body.verificationAuditId || !body.verificationNote?.trim() || !body.rollbackPlan?.trim())
      return Response.json({ error: "A later audit, verification note, and rollback plan are required." }, { status: 400 });
    const existingResponse = await fetch(
      `${value.url}/rest/v1/fix_records?select=status&owner_id=eq.${encodeURIComponent(baseline.owner_id)}&audit_id=eq.${encodeURIComponent(body.auditId)}&opportunity_id=eq.${encodeURIComponent(body.opportunityId)}&limit=1`,
      { headers: headers(value.key), cache: "no-store" },
    );
    if (!existingResponse.ok) return Response.json({ error: "Unable to validate fix state." }, { status: 502 });
    const existing = (await existingResponse.json()) as Array<{ status: string }>;
    if (existing[0]?.status !== "ready")
      return Response.json({ error: "Only ready fixes can be verified." }, { status: 409 });
    const followupResponse = await fetch(
      `${value.url}/rest/v1/audit_runs?select=audit_id,project_id,created_at,status,result${auditScope}&audit_id=eq.${encodeURIComponent(body.verificationAuditId)}&limit=1`,
      { headers: headers(value.key), cache: "no-store" },
    );
    if (!followupResponse.ok) return Response.json({ error: "Unable to validate follow-up audit." }, { status: 502 });
    const followups = (await followupResponse.json()) as Array<{
      project_id: string | null;
      created_at: string;
      status: string;
      result: {
        crawl?: { truncated?: boolean };
        pages?: Array<{ url: string; ok: boolean; status: number }>;
        findings?: Array<{ ruleId: string; url: string }>;
      } | null;
    }>;
    const followup = followups[0];
    if (!followup || followup.project_id !== baseline.project_id || followup.status !== "completed" ||
        Date.parse(followup.created_at) <= Date.parse(baseline.created_at) || !followup.result)
      return Response.json({ error: "Verification requires a later completed audit of this project." }, { status: 409 });
    const coverage = verificationCoverage(baseline.result, followup.result, body.opportunityId);
    if (!coverage.valid) return Response.json({ error: coverage.reason }, { status: 409 });
  }
  const response = await fetch(`${value.url}/rest/v1/fix_records?on_conflict=owner_id,audit_id,opportunity_id`, {
    method: "POST",
    headers: headers(
      value.key,
      "resolution=merge-duplicates,return=representation",
    ),
    body: JSON.stringify({
      owner_id: baseline.owner_id,
      audit_id: body.auditId,
      project_id: body.projectId || null,
      opportunity_id: body.opportunityId,
      title: body.title.slice(0, 240),
      status: body.status,
      evidence: (body.evidence || []).slice(0, 10),
      recommendation: (body.recommendation || "").slice(0, 4000),
      verification_note: (body.verificationNote || "").slice(0, 2000),
      rollback_plan: (body.rollbackPlan || "").slice(0, 2000),
      updated_at: new Date().toISOString(),
    }),
    cache: "no-store",
  });
  if (!response.ok)
    return Response.json(
      { error: "Unable to save fix record." },
      { status: 502 },
    );
  const fix = (await response.json())[0] || null;
  if (!fix) return Response.json({ error: "Fix save returned no record." }, { status: 502 });
  if (body.projectId) {
    const projectResponse = await fetch(
      `${value.url}/rest/v1/projects?select=organization_id&id=eq.${encodeURIComponent(body.projectId)}&limit=1`,
      { headers: headers(value.key), cache: "no-store" },
    );
    const projects = projectResponse.ok
      ? ((await projectResponse.json()) as Array<{
          organization_id: string | null;
        }>)
      : [];
    const organizationId = projects[0]?.organization_id;
    if (organizationId) {
      await fetch(`${value.url}/rest/v1/audit_events`, {
        method: "POST",
        headers: headers(value.key),
        body: JSON.stringify({
          organization_id: organizationId,
          actor_id: actor.id,
          action: `fix.${body.status}`,
          resource_type: "fix_record",
          resource_id: fix.id,
          metadata: {
            auditId: body.auditId,
            opportunityId: body.opportunityId,
          },
        }),
        cache: "no-store",
      }).catch(() => null);
    }
  }
  return Response.json({ fix });
}

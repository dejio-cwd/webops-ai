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
  const auditId = new URL(request.url).searchParams.get("auditId") || "";
  const endpoint = `${value.url}/rest/v1/fix_records?select=id,audit_id,opportunity_id,status,created_at,updated_at&owner_id=eq.${encodeURIComponent(actor.id)}${auditId ? `&audit_id=eq.${encodeURIComponent(auditId)}` : ""}&order=updated_at.desc&limit=100`;
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
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
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
  const response = await fetch(`${value.url}/rest/v1/fix_records`, {
    method: "POST",
    headers: headers(
      value.key,
      "resolution=merge-duplicates,return=representation",
    ),
    body: JSON.stringify({
      owner_id: actor.id,
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
  if (fix && body.projectId) {
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

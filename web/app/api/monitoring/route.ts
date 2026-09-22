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
async function canManage(value: Config, projectId: string, userId: string) {
  const projectResponse = await fetch(
    `${value.url}/rest/v1/projects?select=owner_id,organization_id&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const project = projectResponse.ok
    ? (
        (await projectResponse.json()) as Array<{
          owner_id: string;
          organization_id: string | null;
        }>
      )[0]
    : null;
  if (!project) return false;
  if (project.owner_id === userId) return true;
  if (!project.organization_id) return false;
  const memberResponse = await fetch(
    `${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(project.organization_id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const member = memberResponse.ok
    ? ((await memberResponse.json()) as Array<{ role: string }>)[0]
    : null;
  return ["owner", "admin", "developer"].includes(member?.role || "");
}
export async function GET(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "monitoring-read",
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
  if (!value) return Response.json({ monitors: [] });
  const projectId = new URL(request.url).searchParams.get("projectId") || "";
  const response = await fetch(
    `${value.url}/rest/v1/monitoring_configs?select=id,project_id,cadence,enabled,last_run_at,next_run_at,created_at,updated_at&owner_id=eq.${encodeURIComponent(actor.id)}${projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : ""}&order=created_at.desc`,
    { headers: headers(value.key), cache: "no-store" },
  );
  if (!response.ok)
    return Response.json(
      { error: "Unable to load monitoring configuration." },
      { status: 502 },
    );
  return Response.json(
    { monitors: await response.json() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "monitoring-write",
    limit: 12,
    windowMs: 300_000,
    maxBodyBytes: 8_000,
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
      { error: "Monitoring service is not configured." },
      { status: 503 },
    );
  let body: {
    projectId?: string;
    cadence?: "daily" | "weekly";
    enabled?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const projectId = (body.projectId || "").trim();
  const cadence = body.cadence || "weekly";
  if (!projectId || !["daily", "weekly"].includes(cadence))
    return Response.json(
      { error: "Project and valid cadence are required." },
      { status: 400 },
    );
  if (!(await canManage(value, projectId, actor.id)))
    return Response.json(
      { error: "Owner, admin, or developer access required." },
      { status: 403 },
    );
  const response = await fetch(`${value.url}/rest/v1/monitoring_configs`, {
    method: "POST",
    headers: headers(
      value.key,
      "resolution=merge-duplicates,return=representation",
    ),
    body: JSON.stringify({
      owner_id: actor.id,
      project_id: projectId,
      cadence,
      enabled: body.enabled !== false,
      next_run_at: new Date(
        Date.now() + (cadence === "daily" ? 86400000 : 604800000),
      ).toISOString(),
    }),
    cache: "no-store",
  });
  if (!response.ok)
    return Response.json(
      { error: "Unable to save monitoring configuration." },
      { status: 502 },
    );
  return Response.json({ monitor: (await response.json())[0] || null });
}

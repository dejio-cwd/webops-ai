import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { projectAccess, canManageProject } from "@/lib/security/project-access";
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
  if (projectId && !(await projectAccess(value, projectId, actor.id)))
    return Response.json({ error: "Project access denied." }, { status: 403 });
  const scope = projectId
    ? `&project_id=eq.${encodeURIComponent(projectId)}`
    : `&owner_id=eq.${encodeURIComponent(actor.id)}`;
  const response = await fetch(
    `${value.url}/rest/v1/monitoring_configs?select=id,project_id,cadence,enabled,last_run_at,next_run_at,created_at,updated_at${scope}&order=created_at.desc`,
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
  const access = await projectAccess(value, projectId, actor.id);
  if (!access || !canManageProject(access.role))
    return Response.json(
      { error: "Owner, admin, or developer access required." },
      { status: 403 },
    );
  if (body.enabled !== false && !access.verified_at)
    return Response.json({ error: "Verify project ownership before enabling monitoring." }, { status: 409 });
  const response = await fetch(`${value.url}/rest/v1/monitoring_configs?on_conflict=owner_id,project_id`, {
    method: "POST",
    headers: headers(
      value.key,
      "resolution=merge-duplicates,return=representation",
    ),
    body: JSON.stringify({
      owner_id: access.owner_id,
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

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
    bucket: "monitoring-alerts-read",
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
  if (!value) return Response.json({ alerts: [] });
  const projectId = new URL(request.url).searchParams.get("projectId") || "";
  const response = await fetch(
    `${value.url}/rest/v1/monitoring_alerts?select=id,project_id,audit_id,kind,severity,summary,status,created_at,resolved_at&owner_id=eq.${encodeURIComponent(actor.id)}${projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : ""}&order=created_at.desc&limit=50`,
    { headers: headers(value.key), cache: "no-store" },
  );
  if (!response.ok)
    return Response.json(
      { error: "Unable to load monitoring alerts." },
      { status: 502 },
    );
  return Response.json(
    { alerts: await response.json() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function PATCH(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "monitoring-alerts-write",
    limit: 30,
    windowMs: 300_000,
    maxBodyBytes: 4_000,
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
  let body: { alertId?: string; status?: "open" | "acknowledged" | "resolved" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (
    !body.alertId ||
    !["open", "acknowledged", "resolved"].includes(body.status || "")
  )
    return Response.json(
      { error: "Alert and valid status are required." },
      { status: 400 },
    );
  const response = await fetch(
    `${value.url}/rest/v1/monitoring_alerts?id=eq.${encodeURIComponent(body.alertId)}&owner_id=eq.${encodeURIComponent(actor.id)}`,
    {
      method: "PATCH",
      headers: headers(value.key, "return=representation"),
      body: JSON.stringify({
        status: body.status,
        resolved_at:
          body.status === "resolved" ? new Date().toISOString() : null,
      }),
      cache: "no-store",
    },
  );
  if (!response.ok)
    return Response.json({ error: "Unable to update alert." }, { status: 502 });
  return Response.json({ alert: (await response.json())[0] || null });
}

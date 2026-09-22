import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

type Project = { id: string; owner_id: string; organization_id: string; name: string; domain: string; environment: string; verified_at: string | null; created_at: string };
type Membership = { role: string };

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function headers(serviceKey: string, prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const config = configuration();
  if (!config) return Response.json({ error: "Project service is not configured." }, { status: 503 });
  const endpoint = `${config.url}/rest/v1/projects?select=id,name,domain,environment,verified_at,organization_id,created_at&owner_id=eq.${encodeURIComponent(actor.id)}&order=created_at.desc`;
  const upstream = await fetch(endpoint, { headers: headers(config.serviceKey), cache: "no-store" });
  if (!upstream.ok) return Response.json({ error: "Unable to load projects." }, { status: 502 });
  const projects = await upstream.json() as Project[];
  return Response.json({ projects }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-create", limit: 12, windowMs: 300_000, maxBodyBytes: 12_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const config = configuration();
  if (!config) return Response.json({ error: "Project service is not configured." }, { status: 503 });
  let body: { organizationId?: string; name?: string; domain?: string; environment?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = (body.organizationId || "").trim();
  const name = (body.name || "").trim().slice(0, 100);
  const domain = (body.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");
  const environment = ["production", "staging", "development"].includes(body.environment || "") ? body.environment : "production";
  if (!organizationId || !name || !domain.includes(".")) return Response.json({ error: "Workspace, project name, and a valid domain are required." }, { status: 400 });
  const membershipEndpoint = `${config.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(actor.id)}&limit=1`;
  const membershipResponse = await fetch(membershipEndpoint, { headers: headers(config.serviceKey), cache: "no-store" });
  if (!membershipResponse.ok) return Response.json({ error: "Unable to verify workspace access." }, { status: 502 });
  const memberships = await membershipResponse.json() as Membership[];
  if (!memberships.length) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const projectResponse = await fetch(`${config.url}/rest/v1/projects`, {
    method: "POST", headers: headers(config.serviceKey, "return=representation"),
    body: JSON.stringify({ owner_id: actor.id, organization_id: organizationId, name, domain, environment }), cache: "no-store",
  });
  if (!projectResponse.ok) return Response.json({ error: "Unable to create project." }, { status: 400 });
  const projects = await projectResponse.json() as Project[];
  const project = projects[0];
  if (!project) return Response.json({ error: "Project creation returned no record." }, { status: 502 });
  return Response.json({ project }, { status: 201 });
}

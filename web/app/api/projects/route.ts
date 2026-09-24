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

async function audit(config: { url: string; serviceKey: string }, organizationId: string, actorId: string, action: string, resourceId?: string) {
  await fetch(`${config.url}/rest/v1/audit_events`, { method: "POST", headers: headers(config.serviceKey), body: JSON.stringify({ organization_id: organizationId, actor_id: actorId, action, resource_type: "project", resource_id: resourceId || null, metadata: {} }), cache: "no-store" }).catch(() => null);
}
async function memberRole(config: { url: string; serviceKey: string }, organizationId: string, userId: string) {
  const response = await fetch(`${config.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: headers(config.serviceKey), cache: "no-store" });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ role: string }>;
  return rows[0]?.role || null;
}

async function projectInOrganization(config: { url: string; serviceKey: string }, projectId: string, organizationId: string) {
  const response = await fetch(
    `${config.url}/rest/v1/projects?select=id&id=eq.${encodeURIComponent(projectId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { headers: headers(config.serviceKey), cache: "no-store" },
  );
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ id: string }>;
  return rows.length > 0;
}


export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const config = configuration();
  if (!config) return Response.json({ error: "Project service is not configured." }, { status: 503 });
  const membershipResponse = await fetch(`${config.url}/rest/v1/organization_members?select=organization_id&user_id=eq.${encodeURIComponent(actor.id)}`, { headers: headers(config.serviceKey), cache: "no-store" });
  if (!membershipResponse.ok) return Response.json({ error: "Unable to verify workspace access." }, { status: 502 });
  const memberships = await membershipResponse.json() as Array<{ organization_id: string }>;
  const organizationIds = memberships.map((item) => item.organization_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const queries = [`owner_id.eq.${encodeURIComponent(actor.id)}`];
  if (organizationIds.length) queries.push(`organization_id.in.(${organizationIds.join(",")})`);
  const endpoint = `${config.url}/rest/v1/projects?select=id,name,domain,environment,verified_at,organization_id,created_at&or=(${queries.join(",")})&order=created_at.desc`;
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
  if (!memberships.length || !["owner", "admin", "developer"].includes(memberships[0]?.role || "")) return Response.json({ error: "Owner, admin, or developer access is required to create projects." }, { status: 403 });
  const projectResponse = await fetch(`${config.url}/rest/v1/projects`, {
    method: "POST", headers: headers(config.serviceKey, "return=representation"),
    body: JSON.stringify({ owner_id: actor.id, organization_id: organizationId, name, domain, environment }), cache: "no-store",
  });
  if (!projectResponse.ok) return Response.json({ error: "Unable to create project." }, { status: 400 });
  const projects = await projectResponse.json() as Project[];
  const project = projects[0];
  if (!project) return Response.json({ error: "Project creation returned no record." }, { status: 502 });
  await audit(config, organizationId, actor.id, "project.created", project.id);
  return Response.json({ project }, { status: 201 });
}


export async function DELETE(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-delete", limit: 6, windowMs: 300_000, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const config = configuration();
  if (!config) return Response.json({ error: "Project service is not configured." }, { status: 503 });
  let body: { projectId?: string; organizationId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const projectId = (body.projectId || "").trim(); const organizationId = (body.organizationId || "").trim();
  if (!projectId || !organizationId) return Response.json({ error: "Project and workspace are required." }, { status: 400 });
  const role = await memberRole(config, organizationId, actor.id);
  if (!role || !["owner", "admin"].includes(role)) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  if (!await projectInOrganization(config, projectId, organizationId))
    return Response.json({ error: "Project not found in this workspace." }, { status: 404 });
  const response = await fetch(`${config.url}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&organization_id=eq.${encodeURIComponent(organizationId)}`, { method: "DELETE", headers: headers(config.serviceKey, "return=representation"), cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Unable to delete project." }, { status: 400 });
  const deleted = await response.json() as Array<{ id: string }>;
  if (!deleted.length) return Response.json({ error: "Project not found in this workspace." }, { status: 404 });
  await audit(config, organizationId, actor.id, "project.deleted", projectId);
  return Response.json({ ok: true });
}


export async function PATCH(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-update", limit: 20, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const config = configuration();
  if (!config) return Response.json({ error: "Project service is not configured." }, { status: 503 });
  let body: { projectId?: string; organizationId?: string; environment?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const projectId = (body.projectId || "").trim(); const organizationId = (body.organizationId || "").trim(); const environment = body.environment || "";
  if (!projectId || !organizationId || !["production", "staging", "development"].includes(environment)) return Response.json({ error: "Project, workspace, and a valid environment are required." }, { status: 400 });
  const role = await memberRole(config, organizationId, actor.id);
  if (!role || !["owner", "admin", "developer"].includes(role)) return Response.json({ error: "Owner, admin, or developer access is required." }, { status: 403 });
  if (!await projectInOrganization(config, projectId, organizationId))
    return Response.json({ error: "Project not found in this workspace." }, { status: 404 });
  const response = await fetch(`${config.url}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&organization_id=eq.${encodeURIComponent(organizationId)}`, { method: "PATCH", headers: headers(config.serviceKey, "return=representation"), body: JSON.stringify({ environment }), cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Unable to update project environment." }, { status: 400 });
  const projects = await response.json() as Project[];
  if (!projects.length) return Response.json({ error: "Project not found in this workspace." }, { status: 404 });
  await audit(config, organizationId, actor.id, "project.environment_updated", projectId);
  return Response.json({ project: projects[0] || null });
}

import { guardApiRequest, isGuardResponse, type AuthenticatedActor } from "@/lib/security/api-guard";

const roles = new Set(["owner", "admin", "analyst", "developer", "viewer", "billing"]);
type Member = { organization_id: string; user_id: string; role: string; created_at: string };
type AdminUser = { id: string; email?: string };

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function serviceHeaders(key: string, prefer?: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}
async function membership(actor: AuthenticatedActor, organizationId: string, allowed?: string[]) {
  const value = config(); if (!value) return null;
  const endpoint = `${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(actor.id)}&limit=1`;
  const response = await fetch(endpoint, { headers: serviceHeaders(value.key), cache: "no-store" });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ role: string }>;
  const role = rows[0]?.role;
  return role && (!allowed || allowed.includes(role)) ? role : null;
}
async function protectLastOwner(organizationId: string, userId: string) {
  const value = config(); if (!value) return false;
  const targetResponse = await fetch(`${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${organizationId}&user_id=eq.${userId}&limit=1`, { headers: serviceHeaders(value.key), cache: "no-store" });
  const targets = targetResponse.ok ? await targetResponse.json() as Array<{ role: string }> : [];
  if (targets[0]?.role !== "owner") return true;
  const ownersResponse = await fetch(`${value.url}/rest/v1/organization_members?select=user_id&organization_id=eq.${organizationId}&role=eq.owner`, { headers: serviceHeaders(value.key), cache: "no-store" });
  const owners = ownersResponse.ok ? await ownersResponse.json() as Array<{ user_id: string }> : [];
  return owners.length > 1;
}

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "members-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!organizationId || !await membership(actor, organizationId)) return Response.json({ error: "Workspace access denied." }, { status: 403 });
  const value = config(); if (!value) return Response.json({ error: "Membership service is not configured." }, { status: 503 });
  const membersResponse = await fetch(`${value.url}/rest/v1/organization_members?select=organization_id,user_id,role,created_at&organization_id=eq.${organizationId}&order=created_at.asc`, { headers: serviceHeaders(value.key), cache: "no-store" });
  if (!membersResponse.ok) return Response.json({ error: "Unable to load members." }, { status: 502 });
  const members = await membersResponse.json() as Member[];
  const usersResponse = await fetch(`${value.url}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders(value.key), cache: "no-store" });
  const usersPayload = usersResponse.ok ? await usersResponse.json() as { users?: AdminUser[] } : { users: [] };
  const emailById = new Map((usersPayload.users || []).map((user) => [user.id, user.email || ""]));
  return Response.json({ members: members.map((member) => ({ ...member, email: emailById.get(member.user_id) || null })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "members-create", limit: 12, windowMs: 300_000, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  let body: { organizationId?: string; email?: string; role?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || ""; const email = (body.email || "").trim().toLowerCase(); const role = body.role || "viewer";
  if (!roles.has(role) || !email.includes("@")) return Response.json({ error: "A valid email and role are required." }, { status: 400 });
  if (!await membership(actor, organizationId, ["owner", "admin"])) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  const value = config(); if (!value) return Response.json({ error: "Membership service is not configured." }, { status: 503 });
  const usersResponse = await fetch(`${value.url}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders(value.key), cache: "no-store" });
  const usersPayload = usersResponse.ok ? await usersResponse.json() as { users?: AdminUser[] } : { users: [] };
  const target = (usersPayload.users || []).find((user) => user.email?.toLowerCase() === email);
  if (!target) return Response.json({ error: "This person must create a WebOps AI account before being added." }, { status: 404 });
  const response = await fetch(`${value.url}/rest/v1/organization_members`, { method: "POST", headers: serviceHeaders(value.key, "resolution=merge-duplicates,return=representation"), body: JSON.stringify({ organization_id: organizationId, user_id: target.id, role }), cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Unable to add workspace member." }, { status: 400 });
  const rows = await response.json() as Member[];
  return Response.json({ member: { ...rows[0], email } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "members-update", limit: 20, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  let body: { organizationId?: string; userId?: string; role?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || ""; const userId = body.userId || ""; const role = body.role || "";
  if (!roles.has(role)) return Response.json({ error: "Invalid role." }, { status: 400 });
  if (!await membership(actor, organizationId, ["owner", "admin"])) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  if (role !== "owner" && !await protectLastOwner(organizationId, userId)) return Response.json({ error: "The final workspace owner cannot be downgraded." }, { status: 409 });
  const value = config(); if (!value) return Response.json({ error: "Membership service is not configured." }, { status: 503 });
  const response = await fetch(`${value.url}/rest/v1/organization_members?organization_id=eq.${organizationId}&user_id=eq.${userId}`, { method: "PATCH", headers: serviceHeaders(value.key, "return=representation"), body: JSON.stringify({ role }), cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Unable to update role." }, { status: 400 });
  return Response.json({ member: (await response.json() as Member[])[0] });
}

export async function DELETE(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "members-delete", limit: 12, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  let body: { organizationId?: string; userId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || ""; const userId = body.userId || "";
  if (!await membership(actor, organizationId, ["owner", "admin"])) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  if (!await protectLastOwner(organizationId, userId)) return Response.json({ error: "The final workspace owner cannot be removed." }, { status: 409 });
  const value = config(); if (!value) return Response.json({ error: "Membership service is not configured." }, { status: 503 });
  const response = await fetch(`${value.url}/rest/v1/organization_members?organization_id=eq.${organizationId}&user_id=eq.${userId}`, { method: "DELETE", headers: serviceHeaders(value.key, "return=minimal"), cache: "no-store" });
  return response.ok ? Response.json({ ok: true }) : Response.json({ error: "Unable to remove member." }, { status: 400 });
}

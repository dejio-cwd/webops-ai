import { createHash, randomBytes } from "node:crypto";
import { guardApiRequest, isGuardResponse, type AuthenticatedActor } from "@/lib/security/api-guard";

const roles = new Set(["admin", "analyst", "developer", "viewer", "billing"]);
type Invitation = { id: string; organization_id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string };
function config() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url: url.replace(/\/$/, ""), key } : null; }
function headers(key: string, prefer?: string) { return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }; }
function hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
async function canManage(actor: AuthenticatedActor, organizationId: string) { const value = config(); if (!value) return null; const response = await fetch(`${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(actor.id)}&limit=1`, { headers: headers(value.key), cache: "no-store" }); const rows = response.ok ? await response.json() as Array<{ role: string }> : []; return ["owner", "admin"].includes(rows[0]?.role || "") ? rows[0].role : null; }
async function audit(value: { url: string; key: string }, organizationId: string, actorId: string, action: string, resourceId?: string) { await fetch(`${value.url}/rest/v1/audit_events`, { method: "POST", headers: headers(value.key), body: JSON.stringify({ organization_id: organizationId, actor_id: actorId, action, resource_type: "organization_invitation", resource_id: resourceId || null, metadata: {} }), cache: "no-store" }).catch(() => null); }

export const runtime = "nodejs"; export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "invitations-read", limit: 30, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = new URL(request.url).searchParams.get("organizationId") || ""; const value = config();
  if (!value) return Response.json({ error: "Invitation service is not configured." }, { status: 503 });
  if (!await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  const response = await fetch(`${value.url}/rest/v1/organization_invitations?select=id,organization_id,email,role,expires_at,accepted_at,revoked_at,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc`, { headers: headers(value.key), cache: "no-store" });
  return response.ok ? Response.json({ invitations: await response.json() as Invitation[] }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Unable to load invitations." }, { status: 502 });
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "invitations-create", limit: 8, windowMs: 300_000, maxBodyBytes: 8_000, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const value = config(); if (!value) return Response.json({ error: "Invitation service is not configured." }, { status: 503 });
  let body: { organizationId?: string; email?: string; role?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || ""; const email = (body.email || "").trim().toLowerCase(); const role = body.role || "viewer";
  if (!email.includes("@") || !roles.has(role)) return Response.json({ error: "A valid email and invitation role are required." }, { status: 400 });
  if (!await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  const token = randomBytes(32).toString("base64url");
  const response = await fetch(`${value.url}/rest/v1/organization_invitations`, { method: "POST", headers: headers(value.key, "return=representation"), body: JSON.stringify({ organization_id: organizationId, email, role, token_hash: hash(token), invited_by: actor.id }), cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Unable to create invitation." }, { status: 400 });
  const rows = await response.json() as Invitation[]; const invitation = rows[0];
  await audit(value, organizationId, actor.id, "invitation.created", invitation?.id);
  return Response.json({ invitation, token, acceptPath: `/accept-invitation?token=${encodeURIComponent(token)}` }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "invitations-revoke", limit: 12, maxBodyBytes: 8_000, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const value = config(); if (!value) return Response.json({ error: "Invitation service is not configured." }, { status: 503 });
  let body: { organizationId?: string; invitationId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || ""; const invitationId = body.invitationId || "";
  if (!invitationId || !await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  const response = await fetch(`${value.url}/rest/v1/organization_invitations?id=eq.${encodeURIComponent(invitationId)}&organization_id=eq.${encodeURIComponent(organizationId)}&accepted_at=is.null`, { method: "PATCH", headers: headers(value.key), body: JSON.stringify({ revoked_at: new Date().toISOString() }), cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Unable to revoke invitation." }, { status: 400 });
  await audit(value, organizationId, actor.id, "invitation.revoked", invitationId);
  return Response.json({ ok: true });
}

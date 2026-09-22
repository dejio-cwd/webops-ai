import { createHash } from "node:crypto";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
function config() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url: url.replace(/\/$/, ""), key } : null; }
function headers(key: string, prefer?: string) { return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }; }
function hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "invitations-accept", limit: 8, windowMs: 300_000, maxBodyBytes: 4_000, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const value = config(); if (!value) return Response.json({ error: "Invitation service is not configured." }, { status: 503 });
  let body: { token?: string }; try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const token = (body.token || "").trim(); if (!token) return Response.json({ error: "Invitation token is required." }, { status: 400 });
  const lookup = await fetch(`${value.url}/rest/v1/organization_invitations?select=id,organization_id,email,role,expires_at,accepted_at,revoked_at&token_hash=eq.${hash(token)}&limit=1`, { headers: headers(value.key), cache: "no-store" });
  const invitation = lookup.ok ? (await lookup.json() as Array<{ id: string; organization_id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>)[0] : null;
  if (!invitation || invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) return Response.json({ error: "This invitation is invalid or expired." }, { status: 400 });
  if (!actor.email || actor.email.toLowerCase() !== invitation.email.toLowerCase()) return Response.json({ error: "This invitation belongs to a different email address." }, { status: 403 });
  const existing = await fetch(`${value.url}/rest/v1/organization_members?select=user_id&organization_id=eq.${invitation.organization_id}&user_id=eq.${actor.id}&limit=1`, { headers: headers(value.key), cache: "no-store" });
  if (existing.ok && (await existing.json() as unknown[]).length) return Response.json({ error: "You are already a member of this workspace." }, { status: 409 });
  const membership = await fetch(`${value.url}/rest/v1/organization_members`, { method: "POST", headers: headers(value.key, "return=minimal"), body: JSON.stringify({ organization_id: invitation.organization_id, user_id: actor.id, role: invitation.role }), cache: "no-store" });
  if (!membership.ok) return Response.json({ error: "Unable to accept invitation." }, { status: 400 });
  await fetch(`${value.url}/rest/v1/organization_invitations?id=eq.${invitation.id}`, { method: "PATCH", headers: headers(value.key), body: JSON.stringify({ accepted_at: new Date().toISOString() }), cache: "no-store" });
  await fetch(`${value.url}/rest/v1/audit_events`, { method: "POST", headers: headers(value.key), body: JSON.stringify({ organization_id: invitation.organization_id, actor_id: actor.id, action: "invitation.accepted", resource_type: "organization_invitation", resource_id: invitation.id, metadata: {} }), cache: "no-store" }).catch(() => null);
  return Response.json({ ok: true, organizationId: invitation.organization_id, role: invitation.role });
}

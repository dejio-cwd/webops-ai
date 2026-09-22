import { guardApiRequest, isGuardResponse, type AuthenticatedActor } from "@/lib/security/api-guard";
import { encryptSecret } from "@/lib/security/credential-vault";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

const providers = new Set(["openrouter", "openai", "groq", "anthropic", "google", "custom"]);
function configuration() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url: url.replace(/\/$/, ""), key } : null; }
function headers(key: string, prefer?: string) { return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }; }
async function canManage(actor: AuthenticatedActor, organizationId: string) { const value = configuration(); if (!value) return false; const response = await fetch(`${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${organizationId}&user_id=eq.${actor.id}&limit=1`, { headers: headers(value.key), cache: "no-store" }); const rows = response.ok ? await response.json() as Array<{ role: string }> : []; return ["owner", "admin"].includes(rows[0]?.role || ""); }
async function audit(organizationId: string, actorId: string, action: string, resourceId?: string) { const value = configuration(); if (!value) return; await fetch(`${value.url}/rest/v1/audit_events`, { method: "POST", headers: headers(value.key), body: JSON.stringify({ organization_id: organizationId, actor_id: actorId, action, resource_type: "provider_credential", resource_id: resourceId || null, metadata: {} }), cache: "no-store" }).catch(() => null); }

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "credentials-read", limit: 60, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = new URL(request.url).searchParams.get("organizationId") || "";
  if (!await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  const value = configuration(); if (!value) return Response.json({ error: "Credential vault is not configured." }, { status: 503 });
  const response = await fetch(`${value.url}/rest/v1/provider_credentials?select=id,organization_id,provider,display_name,key_hint,base_url,model_allowlist,scopes,status,created_at,rotated_at,revoked_at&organization_id=eq.${organizationId}&order=created_at.desc`, { headers: headers(value.key), cache: "no-store" });
  return response.ok ? Response.json({ credentials: await response.json() }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Unable to load credentials." }, { status: 502 });
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "credentials-create", limit: 10, windowMs: 300_000, maxBodyBytes: 16_000, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  let body: { organizationId?: string; provider?: string; displayName?: string; apiKey?: string; baseUrl?: string; modelAllowlist?: string[]; scopes?: string[] };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || ""; const provider = body.provider || ""; const secret = body.apiKey || ""; const displayName = (body.displayName || provider).trim().slice(0, 80);
  if (!providers.has(provider) || !secret || !displayName) return Response.json({ error: "Provider, display name, and secret are required." }, { status: 400 });
  if (!await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  try { await validateAiCredentialEndpoint({ provider, baseUrl: body.baseUrl }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Endpoint blocked." }, { status: 400 }); }
  const value = configuration(); if (!value) return Response.json({ error: "Credential vault is not configured." }, { status: 503 });
  try {
    const response = await fetch(`${value.url}/rest/v1/provider_credentials`, { method: "POST", headers: headers(value.key, "return=representation"), body: JSON.stringify({ organization_id: organizationId, created_by: actor.id, provider, display_name: displayName, encrypted_secret: encryptSecret(secret), key_hint: secret.slice(-4), base_url: body.baseUrl || null, model_allowlist: (body.modelAllowlist || []).slice(0, 100), scopes: (body.scopes || []).slice(0, 50), status: "active" }), cache: "no-store" });
    if (!response.ok) return Response.json({ error: "Unable to store credential." }, { status: 400 });
    const row = (await response.json() as Array<{ id: string }>)[0]; await audit(organizationId, actor.id, "credential.created", row?.id);
    return Response.json({ id: row?.id, provider, displayName, keyHint: secret.slice(-4), status: "active" }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Credential encryption failed." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "credentials-rotate", limit: 10, windowMs: 300_000, maxBodyBytes: 12_000, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  let body: { organizationId?: string; credentialId?: string; apiKey?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || "";
  if (!body.credentialId || !body.apiKey || !await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access and a new secret are required." }, { status: 403 });
  const value = configuration(); if (!value) return Response.json({ error: "Credential vault is not configured." }, { status: 503 });
  try {
    const now = new Date().toISOString(); const response = await fetch(`${value.url}/rest/v1/provider_credentials?id=eq.${body.credentialId}&organization_id=eq.${organizationId}`, { method: "PATCH", headers: headers(value.key, "return=representation"), body: JSON.stringify({ encrypted_secret: encryptSecret(body.apiKey), key_hint: body.apiKey.slice(-4), status: "active", rotated_at: now, revoked_at: null }), cache: "no-store" });
    if (!response.ok) return Response.json({ error: "Unable to rotate credential." }, { status: 400 });
    await audit(organizationId, actor.id, "credential.rotated", body.credentialId); return Response.json({ ok: true, keyHint: body.apiKey.slice(-4), rotatedAt: now });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Credential rotation failed." }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "credentials-revoke", limit: 10, maxBodyBytes: 8_000, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  let body: { organizationId?: string; credentialId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || "";
  if (!body.credentialId || !await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access required." }, { status: 403 });
  const value = configuration(); if (!value) return Response.json({ error: "Credential vault is not configured." }, { status: 503 });
  const now = new Date().toISOString(); const response = await fetch(`${value.url}/rest/v1/provider_credentials?id=eq.${body.credentialId}&organization_id=eq.${organizationId}`, { method: "PATCH", headers: headers(value.key), body: JSON.stringify({ status: "revoked", revoked_at: now }), cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Unable to revoke credential." }, { status: 400 });
  await audit(organizationId, actor.id, "credential.revoked", body.credentialId); return Response.json({ ok: true, revokedAt: now });
}

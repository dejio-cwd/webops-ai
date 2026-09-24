import { testCredential } from "@/lib/ai";
import { guardApiRequest, isGuardResponse, type AuthenticatedActor } from "@/lib/security/api-guard";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

const providers = new Set(["openrouter", "openai", "groq", "anthropic", "google", "custom"]);
function configuration() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url: url.replace(/\/$/, ""), key } : null; }
function headers(key: string) { return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }; }
async function canManage(actor: AuthenticatedActor, organizationId: string) { const value = configuration(); if (!value) return false; const response = await fetch(`${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(actor.id)}&limit=1`, { headers: headers(value.key), cache: "no-store" }); const rows = response.ok ? await response.json() as Array<{ role: string }> : []; return ["owner", "admin"].includes(rows[0]?.role || ""); }
async function audit(organizationId: string, actorId: string) { const value = configuration(); if (!value) return; await fetch(`${value.url}/rest/v1/audit_events`, { method: "POST", headers: headers(value.key), body: JSON.stringify({ organization_id: organizationId, actor_id: actorId, action: "credential.tested", resource_type: "provider_credential", metadata: {} }), cache: "no-store" }).catch(() => null); }
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 30;

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "credentials-test-before-save", limit: 8, windowMs: 300_000, maxBodyBytes: 16_000, requireAuth: true }); if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  let body: { organizationId?: string; provider?: string; apiKey?: string; baseUrl?: string; model?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const organizationId = body.organizationId || ""; const provider = body.provider || ""; const apiKey = body.apiKey || "";
  if (!providers.has(provider) || !apiKey || !await canManage(actor, organizationId)) return Response.json({ error: "Owner or admin access and a provider secret are required." }, { status: 403 });
  try {
    await validateAiCredentialEndpoint({ provider, baseUrl: body.baseUrl });
    const result = await testCredential({ provider: provider as never, apiKey, baseUrl: body.baseUrl, model: body.model });
    if (!result.ok) return Response.json({ error: "Provider connection failed. Verify the key, endpoint, and model." }, { status: 400 });
    await audit(organizationId, actor.id);
    return Response.json({ ok: true, message: result.message, latencyMs: result.latencyMs, modelsFound: result.modelsFound }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Provider connection could not be tested." }, { status: 400 }); }
}

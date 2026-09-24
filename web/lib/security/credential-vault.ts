import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AuthenticatedActor } from "@/lib/security/api-guard";

export type VaultCredential = { id: string; organization_id: string; provider: string; display_name: string; encrypted_secret: string; key_hint: string | null; base_url: string | null; model_allowlist: string[]; scopes: string[]; status: string };

function key() {
  const source = process.env.CREDENTIAL_ENCRYPTION_KEY || "";
  if (source.length < 32) throw new Error("Credential encryption key must contain at least 32 characters.");
  return createHash("sha256").update(source).digest();
}
export function encryptSecret(secret: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function fromBase64Url(part: string): Buffer {
  // Reject non-canonical base64url so tampering (e.g. appended or padded characters
  // that decode to identical bytes) is detected instead of silently ignored.
  const buffer = Buffer.from(part, "base64url");
  if (buffer.toString("base64url") !== part) throw new Error("Stored credential is invalid.");
  return buffer;
}
export function decryptSecret(payload: string) {
  const parts = payload.split(".");
  const [version, iv, tag, encrypted] = parts;
  if (parts.length !== 4 || version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), fromBase64Url(iv));
  decipher.setAuthTag(fromBase64Url(tag));
  return Buffer.concat([decipher.update(fromBase64Url(encrypted)), decipher.final()]).toString("utf8");
}
function configuration() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && serviceKey ? { url: url.replace(/\/$/, ""), serviceKey } : null; }
function headers(serviceKey: string) { return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }; }

export async function resolveCredentialForActor(actor: AuthenticatedActor | null, credentialId: string) {
  if (!actor) throw new Error("Authentication required to use stored credentials.");
  const value = configuration(); if (!value) throw new Error("Credential vault is not configured.");
  const response = await fetch(`${value.url}/rest/v1/provider_credentials?select=id,organization_id,provider,display_name,encrypted_secret,key_hint,base_url,model_allowlist,scopes,status&id=eq.${encodeURIComponent(credentialId)}&status=eq.active&limit=1`, { headers: headers(value.serviceKey), cache: "no-store" });
  const rows = response.ok ? await response.json() as VaultCredential[] : [];
  const stored = rows[0]; if (!stored) throw new Error("Stored credential was not found.");
  const memberResponse = await fetch(`${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${stored.organization_id}&user_id=eq.${actor.id}&limit=1`, { headers: headers(value.serviceKey), cache: "no-store" });
  const memberships = memberResponse.ok ? await memberResponse.json() as Array<{ role: string }> : [];
  if (!memberships.length) throw new Error("Credential access denied.");
  return { provider: stored.provider, apiKey: decryptSecret(stored.encrypted_secret), baseUrl: stored.base_url || undefined, model: stored.model_allowlist[0] || undefined, scopes: stored.scopes, modelAllowlist: stored.model_allowlist };
}

import type { Credential } from "@/lib/ai";
import type { AuthenticatedActor } from "@/lib/security/api-guard";
import { resolveCredentialForActor } from "@/lib/security/credential-vault";

type CredentialInput = { provider?: string; apiKey?: string; baseUrl?: string; model?: string };
type RequestBody = { credentialId?: string; credential?: CredentialInput };
export type CredentialScope = "chat" | "generate" | "models" | "test";

type GovernedCredential = Credential & { modelAllowlist?: string[]; scopes?: string[] };

export async function credentialFromRequest(actor: AuthenticatedActor | null, body: RequestBody): Promise<GovernedCredential | undefined> {
  if (body.credentialId) return await resolveCredentialForActor(actor, body.credentialId) as GovernedCredential;
  if (!body.credential) return undefined;
  if (body.credential.apiKey && process.env.ALLOW_EPHEMERAL_AI_CREDENTIALS !== "true") {
    throw new Error("Plaintext AI credentials are disabled. Save the provider in the encrypted credential vault.");
  }
  return { provider: body.credential.provider, apiKey: body.credential.apiKey, baseUrl: body.credential.baseUrl, model: body.credential.model } as GovernedCredential;
}

export function enforceCredentialPolicy(credential: GovernedCredential, requestedModel: unknown, scope: CredentialScope): GovernedCredential {
  const scopes = credential.scopes || [];
  if (scopes.length && !scopes.includes(scope)) throw new Error("This credential is not permitted for the requested AI operation.");
  const model = typeof requestedModel === "string" && requestedModel.trim() ? requestedModel.trim() : credential.model;
  const allowlist = credential.modelAllowlist || [];
  if (allowlist.length && model && !allowlist.includes(model)) throw new Error("The requested model is not allowed for this credential.");
  return model && model !== credential.model ? { ...credential, model } : credential;
}

export function filterCredentialModels<T extends { id: string }>(credential: GovernedCredential, models: T[]): T[] {
  const allowlist = credential.modelAllowlist || [];
  return allowlist.length ? models.filter((model) => allowlist.includes(model.id)) : models;
}

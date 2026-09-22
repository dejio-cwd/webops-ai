import type { Credential } from "@/lib/ai";
import type { AuthenticatedActor } from "@/lib/security/api-guard";
import { resolveCredentialForActor } from "@/lib/security/credential-vault";

type CredentialInput = { provider?: string; apiKey?: string; baseUrl?: string; model?: string };
type RequestBody = { credentialId?: string; credential?: CredentialInput };

export async function credentialFromRequest(actor: AuthenticatedActor | null, body: RequestBody): Promise<Credential | undefined> {
  if (body.credentialId) return await resolveCredentialForActor(actor, body.credentialId) as Credential;
  if (!body.credential) return undefined;
  if (body.credential.apiKey && process.env.ALLOW_EPHEMERAL_AI_CREDENTIALS !== "true") {
    throw new Error("Plaintext AI credentials are disabled. Save the provider in the encrypted credential vault.");
  }
  return { provider: body.credential.provider, apiKey: body.credential.apiKey, baseUrl: body.credential.baseUrl, model: body.credential.model } as Credential;
}

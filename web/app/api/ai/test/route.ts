import { testCredential } from "@/lib/ai";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { credentialFromRequest } from "@/lib/security/ai-credential";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 30;
export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "ai-test", limit: 8 }); if (isGuardResponse(actor)) return actor;
  let body: any; try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body?.credentialId && !body?.credential && !body?.provider) return Response.json({ error: "A provider credential is required." }, { status: 400 });
  try { const credential = await credentialFromRequest(actor, body.credential ? body : { ...body, credential: body.apiKey ? { provider: body.provider, apiKey: body.apiKey, baseUrl: body.baseUrl, model: body.model } : undefined }); if (!credential) throw new Error("A stored credential is required."); await validateAiCredentialEndpoint(credential); return Response.json(await testCredential(credential), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Connection test blocked." }, { status: 400 }); }
}

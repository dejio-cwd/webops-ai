import { listModels } from "@/lib/ai";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { credentialFromRequest } from "@/lib/security/ai-credential";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "ai-models", limit: 12 }); if (isGuardResponse(actor)) return actor;
  let body: any; try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  try { const credential = await credentialFromRequest(actor, body.credential ? body : { ...body, credential: body.apiKey ? { provider: body.provider, apiKey: body.apiKey, baseUrl: body.baseUrl, model: body.model } : undefined }); if (!credential) throw new Error("A stored credential is required."); await validateAiCredentialEndpoint(credential); const models = await listModels(credential); return Response.json({ provider: credential.provider, models, count: models.length }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Model discovery blocked." }, { status: 400 }); }
}

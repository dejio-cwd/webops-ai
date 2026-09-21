import { listModels, type Credential } from "@/lib/ai";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "ai-models", limit: 12 });
  if (isGuardResponse(guard)) return guard;
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body?.provider) return Response.json({ error: "A provider is required." }, { status: 400 });
  const credential: Credential = { provider: body.provider, apiKey: body.apiKey || undefined, baseUrl: body.baseUrl || undefined, model: body.model || undefined };
  try {
    await validateAiCredentialEndpoint(credential);
    const models = await listModels(credential);
    return Response.json({ provider: credential.provider, models, count: models.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Model discovery blocked." }, { status: 400 });
  }
}

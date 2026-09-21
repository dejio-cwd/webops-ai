import { testCredential, type Credential } from "@/lib/ai";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { validateAiCredentialEndpoint } from "@/lib/security/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "ai-test", limit: 8 });
  if (isGuardResponse(guard)) return guard;
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body?.provider) return Response.json({ error: "A provider is required." }, { status: 400 });
  const credential: Credential = { provider: body.provider, apiKey: body.apiKey || undefined, baseUrl: body.baseUrl || undefined, model: body.model || undefined };
  try {
    await validateAiCredentialEndpoint(credential);
    return Response.json(await testCredential(credential), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Connection test blocked." }, { status: 400 });
  }
}

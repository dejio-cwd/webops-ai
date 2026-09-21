// POST /api/ai/models -> live model list for a SPECIFIC credential (BYOK or
// server env). Used by AI Studio's "Discover models" button so a user can pick
// exactly which model to run, for any provider including custom endpoints.
// Body: { provider, apiKey?, baseUrl?, model? }

import { listModels, type Credential } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.provider) {
    return Response.json({ error: "A provider is required." }, { status: 400 });
  }
  const credential: Credential = {
    provider: body.provider,
    apiKey: body.apiKey || undefined,
    baseUrl: body.baseUrl || undefined,
    model: body.model || undefined,
  };
  const models = await listModels(credential);
  return Response.json(
    { provider: credential.provider, models, count: models.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/ai/test -> validate a BYOK credential actually works before the
// user relies on it. Tries a model listing first, falls back to a 1-token
// live completion. Body: { provider, apiKey?, baseUrl?, model? }

import { testCredential, type Credential } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  const result = await testCredential(credential);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

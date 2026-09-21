// GET /api/models -> AI provider catalogue, which providers are configured
// server-side, and a live-discovered list of free OpenRouter models.

import { availableProviders, discoverFreeModels } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const catalog = [
  { provider: "openrouter", label: "OpenRouter", tier: "free+byok", note: "Access hundreds of models incl. free ones" },
  { provider: "openai", label: "OpenAI", tier: "byok", note: "GPT-4o / GPT-4o-mini" },
  { provider: "anthropic", label: "Anthropic", tier: "byok", note: "Claude family" },
  { provider: "google", label: "Google", tier: "byok", note: "Gemini family" },
  { provider: "groq", label: "Groq", tier: "byok", note: "Ultra low-latency inference" },
];

export async function GET() {
  const configured = availableProviders();
  const freeModels = await discoverFreeModels();
  return Response.json(
    {
      configuredProviders: configured,
      hasAnyProvider: configured.length > 0,
      catalog,
      freeModels,
      freeModelCount: freeModels.length,
      refreshedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

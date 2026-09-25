// GET /api/models -> full provider catalogue, which providers are configured
// server-side via env vars, and a live-discovered list of free OpenRouter models.
// This powers the "Providers" grid in AI Studio. For live, per-credential model
// listing (including BYOK and custom endpoints) see POST /api/ai/models.

import { providerCatalog, availableProviders, discoverFreeModels } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = availableProviders();
  // OpenRouter probe can throw on network hiccups; treat as an empty list so the
  // provider grid still renders instead of collapsing the workspace with a 500.
  const freeModels = await discoverFreeModels().catch(() => []);
  return Response.json(
    {
      configuredProviders: configured,
      hasAnyProvider: configured.length > 0,
      catalog: providerCatalog(),
      freeModels,
      freeModelCount: freeModels.length,
      refreshedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

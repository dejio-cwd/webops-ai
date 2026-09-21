import { runAudit } from "@/lib/audit";
import { SsrfError } from "@/lib/ssrf";
import { HARD_MAX_PAGES, HARD_MAX_DEPTH, HARD_MAX_CONCURRENCY } from "@/lib/crawler";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "audit", limit: 4, windowMs: 60_000, maxBodyBytes: 16_000 });
  if (isGuardResponse(guard)) return guard;
  let body: { url?: string; maxPages?: number; maxDepth?: number; respectRobots?: boolean; concurrency?: number; checkExternalLinks?: boolean };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const url = (body.url || "").trim();
  if (!url) return Response.json({ error: "A url is required." }, { status: 400 });
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const maxPages = clamp(body.maxPages ?? 20, 1, HARD_MAX_PAGES);
  const maxDepth = clamp(body.maxDepth ?? 3, 0, HARD_MAX_DEPTH);
  const concurrency = clamp(body.concurrency ?? 6, 1, HARD_MAX_CONCURRENCY);
  try {
    const result = await runAudit(withScheme, {
      maxPages, maxDepth, concurrency,
      respectRobots: body.respectRobots ?? true,
      checkExternalLinks: body.checkExternalLinks ?? true,
      deadlineMs: 50_000,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Audit failed." }, {
      status: error instanceof SsrfError ? 400 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? min : Math.max(min, Math.min(max, Math.round(parsed)));
}

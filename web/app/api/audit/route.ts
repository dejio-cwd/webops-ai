// POST /api/audit  ->  full multi-page audit
// Body: {
//   url: string, maxPages?: number, maxDepth?: number, respectRobots?: boolean,
//   concurrency?: number, checkExternalLinks?: boolean
// }
//
// Runs a bounded, deadline-aware crawl entirely within the serverless function.
// maxPages/maxDepth/concurrency are user-configurable (see "Crawl settings" in
// the UI) up to the hard ceilings in lib/crawler.ts — there is no fixed "50 page"
// limit baked into the product; the practical limit is the function's own
// deadline, which the crawler already handles gracefully (reports `truncated`).
// For very large sites (thousands of URLs) the roadmap's queue + worker
// architecture is the next step; this route is tuned to complete inside one
// serverless invocation.

import { runAudit } from "@/lib/audit";
import { SsrfError } from "@/lib/ssrf";
import { HARD_MAX_PAGES, HARD_MAX_DEPTH, HARD_MAX_CONCURRENCY } from "@/lib/crawler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: {
    url?: string;
    maxPages?: number;
    maxDepth?: number;
    respectRobots?: boolean;
    concurrency?: number;
    checkExternalLinks?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = (body.url || "").trim();
  if (!url) return Response.json({ error: "A url is required." }, { status: 400 });

  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const maxPages = clamp(body.maxPages ?? 20, 1, HARD_MAX_PAGES);
  const maxDepth = clamp(body.maxDepth ?? 3, 0, HARD_MAX_DEPTH);
  const concurrency = clamp(body.concurrency ?? 6, 1, HARD_MAX_CONCURRENCY);

  try {
    const result = await runAudit(withScheme, {
      maxPages,
      maxDepth,
      concurrency,
      respectRobots: body.respectRobots ?? true,
      checkExternalLinks: body.checkExternalLinks ?? true,
      deadlineMs: 50000,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof SsrfError ? 400 : 500;
    return Response.json(
      { error: err instanceof Error ? err.message : "Audit failed." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function clamp(n: number, min: number, max: number): number {
  n = Number(n);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

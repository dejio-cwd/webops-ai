// POST /api/audit  ->  full multi-page audit
// Body: { url: string, maxPages?: number, maxDepth?: number, respectRobots?: boolean }
//
// Runs a bounded, deadline-aware crawl entirely within the serverless function.
// For very large sites (thousands of URLs) this is where the roadmap's queue +
// worker architecture takes over; this route is tuned to complete quickly.

import { runAudit } from "@/lib/audit";
import { SsrfError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { url?: string; maxPages?: number; maxDepth?: number; respectRobots?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = (body.url || "").trim();
  if (!url) return Response.json({ error: "A url is required." }, { status: 400 });

  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const maxPages = clamp(body.maxPages ?? 20, 1, 50);
  const maxDepth = clamp(body.maxDepth ?? 3, 0, 6);

  try {
    const result = await runAudit(withScheme, {
      maxPages,
      maxDepth,
      respectRobots: body.respectRobots ?? true,
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

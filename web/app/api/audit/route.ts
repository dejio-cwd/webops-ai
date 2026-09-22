// POST /api/audit -> full multi-page audit
// Body: { url: string, maxPages?: number, maxDepth?: number, respectRobots?: boolean,
// concurrency?: number, checkExternalLinks?: boolean }
//
// Runs a bounded, deadline-aware crawl entirely within the serverless function.
// The route is authenticated because crawling is an expensive outbound operation.

import { runAudit } from "@/lib/audit";
import { SsrfError } from "@/lib/ssrf";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import {
  HARD_MAX_PAGES,
  HARD_MAX_DEPTH,
  HARD_MAX_CONCURRENCY,
} from "@/lib/crawler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SupabaseConfig = { url: string; key: string };
function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function supabaseHeaders(key: string, prefer?: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "audit-history-read",
    limit: 60,
    requireAuth: true,
  });
  if (isGuardResponse(actor)) return actor;
  if (!actor)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const config = supabaseConfig();
  if (!config)
    return Response.json(
      { runs: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  const auditId = new URL(request.url).searchParams.get("auditId") || "";
  const select = auditId
    ? "id,url,audit_id,engine_version,status,summary,result,created_at,completed_at"
    : "id,url,audit_id,engine_version,status,summary,created_at,completed_at";
  const endpoint = `${config.url}/rest/v1/audit_runs?select=${select}&owner_id=eq.${encodeURIComponent(actor.id)}${auditId ? `&audit_id=eq.${encodeURIComponent(auditId)}&limit=1` : "&order=created_at.desc&limit=20"}`;
  const response = await fetch(endpoint, {
    headers: supabaseHeaders(config.key),
    cache: "no-store",
  });
  if (!response.ok)
    return Response.json(
      { error: "Unable to load audit history." },
      { status: 502 },
    );
  const rows = await response.json();
  if (auditId) {
    return rows[0]?.result
      ? Response.json(
          { audit: rows[0].result },
          { headers: { "Cache-Control": "no-store" } },
        )
      : Response.json({ error: "Audit not found." }, { status: 404 });
  }
  return Response.json(
    { runs: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "audit-run",
    limit: 8,
    windowMs: 300_000,
    maxBodyBytes: 12_000,
    requireAuth: true,
  });
  if (isGuardResponse(actor)) return actor;
  if (!actor)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );

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
  if (!url)
    return Response.json({ error: "A url is required." }, { status: 400 });

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
    const config = supabaseConfig();
    if (config) {
      await fetch(`${config.url}/rest/v1/audit_runs`, {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify({
          owner_id: actor.id,
          url: withScheme,
          audit_id: result.auditId,
          engine_version: result.version,
          status: result.crawl.truncated ? "truncated" : "completed",
          summary: {
            pagesCrawled: result.crawl.pagesCrawled,
            findings: result.findings.length,
            opportunities: result.opportunities.length,
            healthScore: result.health.overall,
          },
          result,
          completed_at: new Date().toISOString(),
        }),
        cache: "no-store",
      }).catch(() => null);
    }
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

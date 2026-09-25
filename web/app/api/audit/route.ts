// POST /api/audit -> full multi-page audit
// Body: { url: string, maxPages?: number, maxDepth?: number,
// concurrency?: number, checkExternalLinks?: boolean }. Robots compliance is enforced server-side.
//
// Runs a bounded, deadline-aware crawl entirely within the serverless function.
// The route is authenticated because crawling is an expensive outbound operation.

import { runAudit, NoCrawlEvidenceError } from "@/lib/audit";
import { compareAudits } from "@/lib/audit-comparison";
import type { AuditResult } from "@/lib/types";
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

type ProjectAccess = {
  id: string;
  owner_id: string;
  organization_id: string | null;
  domain: string;
  environment: string;
  role: string | null;
};
async function projectAccess(config: SupabaseConfig, projectId: string, actorId: string): Promise<ProjectAccess | null> {
  const response = await fetch(
    `${config.url}/rest/v1/projects?select=id,owner_id,organization_id,domain,environment&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    { headers: supabaseHeaders(config.key), cache: "no-store" },
  );
  if (!response.ok) return null;
  const project = (await response.json() as Array<Omit<ProjectAccess, "role">>)[0];
  if (!project) return null;
  if (project.owner_id === actorId) return { ...project, role: "owner" };
  if (!project.organization_id) return { ...project, role: null };
  const membershipResponse = await fetch(
    `${config.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(project.organization_id)}&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { headers: supabaseHeaders(config.key), cache: "no-store" },
  );
  const members = membershipResponse.ok ? await membershipResponse.json() as Array<{ role: string }> : [];
  return { ...project, role: members[0]?.role || null };
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
  const searchParams = new URL(request.url).searchParams;
  const auditId = searchParams.get("auditId") || "";
  const projectId = searchParams.get("projectId") || "";
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId))
    return Response.json({ error: "Invalid project ID." }, { status: 400 });
  if (projectId && !(await projectAccess(config, projectId, actor.id))?.role)
    return Response.json({ error: "Project access denied." }, { status: 403 });
  const ownerFilter = projectId ? "" : `&owner_id=eq.${encodeURIComponent(actor.id)}`;
  const projectFilter = projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : "";
  const beforeId = searchParams.get("before") || "";
  const afterId = searchParams.get("after") || "";
  if (beforeId && afterId) {
    const comparisonEndpoint = `${config.url}/rest/v1/audit_runs?select=audit_id,result${ownerFilter}${projectFilter}&audit_id=in.(${encodeURIComponent(beforeId)},${encodeURIComponent(afterId)})`;
    const comparisonResponse = await fetch(comparisonEndpoint, {
      headers: supabaseHeaders(config.key),
      cache: "no-store",
    });
    if (!comparisonResponse.ok)
      return Response.json(
        { error: "Unable to load audit comparison." },
        { status: 502 },
      );
    const rows = (await comparisonResponse.json()) as Array<{
      audit_id: string;
      result: AuditResult | null;
    }>;
    const before = rows.find((row) => row.audit_id === beforeId)?.result;
    const after = rows.find((row) => row.audit_id === afterId)?.result;
    return before && after
      ? Response.json(
          { comparison: compareAudits(before, after) },
          { headers: { "Cache-Control": "no-store" } },
        )
      : Response.json(
          { error: "Both audits must belong to the current account." },
          { status: 404 },
        );
  }
  const select = auditId
    ? "id,project_id,url,audit_id,engine_version,status,summary,result,created_at,completed_at"
    : "id,project_id,url,audit_id,engine_version,status,summary,created_at,completed_at";
  const endpoint = `${config.url}/rest/v1/audit_runs?select=${select}${ownerFilter}${projectFilter}${auditId ? `&audit_id=eq.${encodeURIComponent(auditId)}&limit=1` : "&order=created_at.desc&limit=20"}`;
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
    projectId?: string;
    environment?: string;
    maxPages?: number;
    maxDepth?: number;
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
  const projectId = (body.projectId || "").trim();
  const environment =
    body.environment &&
    ["production", "staging", "development"].includes(body.environment)
      ? body.environment
      : null;
  let associatedProjectId: string | null = null;
  const config = supabaseConfig();
  if (projectId && !config)
    return Response.json({ error: "Project service is not configured." }, { status: 503 });
  if (projectId && config) {
    const project = await projectAccess(config, projectId, actor.id);
    if (!project?.role || !["owner", "admin", "developer"].includes(project.role))
      return Response.json({ error: "Project audit access denied." }, { status: 403 });
    let host = "";
    try { host = new URL(withScheme).hostname.toLowerCase(); } catch { /* rejected below */ }
    const domain = project.domain.toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`))
      return Response.json({ error: "Audit URL must match the selected project domain." }, { status: 400 });
    if (environment && environment !== project.environment)
      return Response.json({ error: "Audit environment must match the selected project." }, { status: 400 });
    associatedProjectId = project.id;
  }
  const maxPages = clamp(body.maxPages ?? 20, 1, HARD_MAX_PAGES);
  const maxDepth = clamp(body.maxDepth ?? 3, 0, HARD_MAX_DEPTH);
  const concurrency = clamp(body.concurrency ?? 6, 1, HARD_MAX_CONCURRENCY);

  try {
    const result = await runAudit(withScheme, {
      maxPages,
      maxDepth,
      concurrency,
      respectRobots: true,
      checkExternalLinks: body.checkExternalLinks ?? true,
      deadlineMs: 50000,
    });
    if (config) {
      const saved = await fetch(`${config.url}/rest/v1/audit_runs`, {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify({
          owner_id: actor.id,
          project_id: associatedProjectId,
          url: withScheme,
          audit_id: result.auditId,
          engine_version: result.version,
          status: result.crawl.truncated ? "truncated" : "completed",
          summary: {
            environment,
            pagesCrawled: result.crawl.pagesCrawled,
            findings: result.findings.length,
            opportunities: result.opportunities.length,
            healthScore: result.health.overall,
          },
          result,
          completed_at: new Date().toISOString(),
        }),
        cache: "no-store",
      });
      if (!saved.ok) return Response.json({ error: "The crawl finished, but saving failed. Please retry; this audit is not in history." }, { status: 502 });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof SsrfError ? 400 : err instanceof NoCrawlEvidenceError ? 422 : 500;
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

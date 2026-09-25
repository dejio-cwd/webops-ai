// POST /api/audit -> full multi-page audit
// Body: { url: string, maxPages?: number, maxDepth?: number,
// concurrency?: number, checkExternalLinks?: boolean }. Robots compliance is enforced server-side.
//
// Queues a durable audit; evidence is persisted incrementally by workers.
// The route is authenticated because crawling is an expensive outbound operation.

import { launchAudit } from "@/lib/pipeline/launch";
import { compareAudits } from "@/lib/audit-comparison";
import type { AuditResult } from "@/lib/types";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";


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
    if (rows[0] && !rows[0].result && rows[0].engine_version === "2.0.0") return Response.json({ jobId: rows[0].id });
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
  try {
    const jobId = await launchAudit(actor.id, { url: withScheme, projectId: associatedProjectId || undefined, config: { maxPages: body.maxPages, maxDepth: body.maxDepth, concurrency: body.concurrency, checkExternalLinks: body.checkExternalLinks, respectRobots: true } });
    return Response.json({ jobId, status: "QUEUED" }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save and queue audit." }, { status: 400 });
  }
}

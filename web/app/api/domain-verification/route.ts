import { createHash, randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import {
  guardApiRequest,
  isGuardResponse,
  type AuthenticatedActor,
} from "@/lib/security/api-guard";
import { validateTarget } from "@/lib/ssrf";

type Project = {
  id: string;
  owner_id: string;
  organization_id: string;
  domain: string;
  verified_at: string | null;
};
type Verification = {
  id: string;
  project_id: string;
  method: "dns" | "file" | "meta";
  token_hash: string;
  status: string;
  verified_at: string | null;
  created_at: string;
};

type Config = { url: string; key: string };
function config(): Config | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
function headers(key: string, prefer?: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}
function digest(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}
async function audit(
  value: Config,
  organizationId: string,
  actorId: string,
  action: string,
  resourceId: string | null,
  metadata: Record<string, string | boolean> = {},
) {
  await fetch(`${value.url}/rest/v1/audit_events`, {
    method: "POST",
    headers: headers(value.key),
    body: JSON.stringify({
      organization_id: organizationId,
      actor_id: actorId,
      action,
      resource_type: "domain_verification",
      resource_id: resourceId,
      metadata,
    }),
    cache: "no-store",
  }).catch(() => null);
}

async function projectAccess(
  actor: AuthenticatedActor,
  projectId: string,
  mutate: boolean,
) {
  const value = config();
  if (!value) return null;
  const projectResponse = await fetch(
    `${value.url}/rest/v1/projects?select=id,owner_id,organization_id,domain,verified_at&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const projects = projectResponse.ok
    ? ((await projectResponse.json()) as Project[])
    : [];
  const project = projects[0];
  if (!project) return null;
  if (project.owner_id === actor.id) return project;
  const memberResponse = await fetch(
    `${value.url}/rest/v1/organization_members?select=role&organization_id=eq.${project.organization_id}&user_id=eq.${actor.id}&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const members = memberResponse.ok
    ? ((await memberResponse.json()) as Array<{ role: string }>)
    : [];
  const allowed = mutate
    ? ["owner", "admin", "developer"]
    : ["owner", "admin", "analyst", "developer", "viewer", "billing"];
  return allowed.includes(members[0]?.role || "") ? project : null;
}
async function candidates(project: Project, method: Verification["method"]) {
  if (method === "dns") {
    const records = await Promise.allSettled([
      dns.resolveTxt(`_webops.${project.domain}`),
      dns.resolveTxt(project.domain),
    ]);
    return records.flatMap((result) =>
      result.status === "fulfilled"
        ? result.value.map((parts) => parts.join(""))
        : [],
    );
  }
  const path =
    method === "file" ? "/.well-known/webops-ai-verification.txt" : "/";
  const target = await validateTarget("https://" + project.domain + path);
  const response = await fetch(target, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "WebOpsAI-Verification/1.0" },
  });
  if (!response.ok) return [];
  const text = (await response.text()).slice(0, 1_000_000);
  return method === "file"
    ? [text.trim()]
    : text.match(/webops-ai-verification=[a-f0-9]{48}/gi) || [];
}

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "domain-read",
    limit: 60,
    requireAuth: true,
  });
  if (isGuardResponse(actor)) return actor;
  if (!actor)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const projectId = new URL(request.url).searchParams.get("projectId") || "";
  const project = await projectAccess(actor, projectId, false);
  if (!project)
    return Response.json({ error: "Project access denied." }, { status: 403 });
  const value = config();
  if (!value)
    return Response.json(
      { error: "Verification service is not configured." },
      { status: 503 },
    );
  const response = await fetch(
    `${value.url}/rest/v1/domain_verifications?select=id,project_id,method,status,verified_at,created_at&project_id=eq.${project.id}&order=created_at.desc&limit=10`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const verifications = response.ok ? await response.json() : [];
  return Response.json(
    {
      project: {
        id: project.id,
        domain: project.domain,
        verifiedAt: project.verified_at,
      },
      verifications,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, {
    bucket: "domain-write",
    limit: 12,
    windowMs: 300_000,
    maxBodyBytes: 8_000,
    requireAuth: true,
  });
  if (isGuardResponse(actor)) return actor;
  if (!actor)
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  let body: {
    projectId?: string;
    action?: "start" | "verify";
    method?: Verification["method"];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const method = body.method || "dns";
  if (!["dns", "file", "meta"].includes(method))
    return Response.json(
      { error: "Invalid verification method." },
      { status: 400 },
    );
  const project = await projectAccess(actor, body.projectId || "", true);
  if (!project)
    return Response.json(
      { error: "Developer, admin, or owner access required." },
      { status: 403 },
    );
  const value = config();
  if (!value)
    return Response.json(
      { error: "Verification service is not configured." },
      { status: 503 },
    );
  if (body.action === "start") {
    const marker = `webops-ai-verification=${randomBytes(24).toString("hex")}`;
    await fetch(
      `${value.url}/rest/v1/domain_verifications?project_id=eq.${project.id}&status=eq.pending`,
      { method: "DELETE", headers: headers(value.key), cache: "no-store" },
    );
    const create = await fetch(`${value.url}/rest/v1/domain_verifications`, {
      method: "POST",
      headers: headers(value.key, "return=representation"),
      body: JSON.stringify({
        project_id: project.id,
        method,
        token_hash: digest(marker),
        status: "pending",
      }),
      cache: "no-store",
    });
    if (!create.ok)
      return Response.json(
        { error: "Unable to start domain verification." },
        { status: 502 },
      );
    const verification = ((await create.json()) as Verification[])[0];
    await audit(
      value,
      project.organization_id,
      actor.id,
      "domain_verification.started",
      verification?.id || null,
      { method },
    );
    const instructions =
      method === "dns"
        ? { type: "TXT", host: `_webops.${project.domain}`, value: marker }
        : method === "file"
          ? {
              path:
                "https://" +
                project.domain +
                "/.well-known/webops-ai-verification.txt",
              value: marker,
            }
          : { tag: `<meta name="webops-ai-verification" content="${marker}">` };
    return Response.json({ verification, instructions }, { status: 201 });
  }
  const pendingResponse = await fetch(
    `${value.url}/rest/v1/domain_verifications?select=id,project_id,method,token_hash,status,verified_at,created_at&project_id=eq.${project.id}&method=eq.${method}&status=eq.pending&order=created_at.desc&limit=1`,
    { headers: headers(value.key), cache: "no-store" },
  );
  const pending = pendingResponse.ok
    ? ((await pendingResponse.json()) as Verification[])[0]
    : null;
  if (!pending)
    return Response.json(
      { error: "Start verification before checking it." },
      { status: 409 },
    );
  try {
    const found = (await candidates(project, method)).some(
      (candidate) => digest(candidate) === pending.token_hash,
    );
    if (!found) {
      await audit(
        value,
        project.organization_id,
        actor.id,
        "domain_verification.check_failed",
        pending.id,
        { method, found: false },
      );
      return Response.json(
        { verified: false, error: "Verification token was not found yet." },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    await fetch(
      `${value.url}/rest/v1/domain_verifications?id=eq.${pending.id}`,
      {
        method: "PATCH",
        headers: headers(value.key),
        body: JSON.stringify({ status: "verified", verified_at: now }),
        cache: "no-store",
      },
    );
    await fetch(`${value.url}/rest/v1/projects?id=eq.${project.id}`, {
      method: "PATCH",
      headers: headers(value.key),
      body: JSON.stringify({ verified_at: now }),
      cache: "no-store",
    });
    await audit(
      value,
      project.organization_id,
      actor.id,
      "domain_verification.verified",
      pending.id,
      { method, found: true },
    );
    return Response.json({ verified: true, verifiedAt: now });
  } catch (error) {
    await audit(
      value,
      project.organization_id,
      actor.id,
      "domain_verification.check_error",
      pending.id,
      { method },
    );
    return Response.json(
      {
        verified: false,
        error:
          error instanceof Error ? error.message : "Verification check failed.",
      },
      { status: 502 },
    );
  }
}

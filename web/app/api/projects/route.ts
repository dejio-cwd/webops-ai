import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { jsonOrError, supabaseRest } from "@/lib/supabase-rest";

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  try {
    const response = await supabaseRest("/rest/v1/projects?select=id,name,domain,environment,verified_at,organization_id,created_at&order=created_at.desc", { accessToken: actor!.accessToken });
    return Response.json({ projects: await jsonOrError(response) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load projects." }, { status: 502 }); }
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-create", limit: 12, windowMs: 300_000, maxBodyBytes: 12_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  let body: { organizationId?: string; name?: string; domain?: string; environment?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const name = (body.name || "").trim().slice(0, 100); const organizationId = (body.organizationId || "").trim();
  let domain = (body.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!name || !organizationId || !domain || !domain.includes(".")) return Response.json({ error: "Organization, project name, and a valid domain are required." }, { status: 400 });
  try {
    const response = await supabaseRest("/rest/v1/projects", {
      accessToken: actor!.accessToken, method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ owner_id: actor!.id, organization_id: organizationId, name, domain, environment: body.environment || "production" }),
    });
    const projects = await jsonOrError(response);
    return Response.json({ project: projects[0] }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create project." }, { status: 400 }); }
}

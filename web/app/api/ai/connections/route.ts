import { database, databaseConfig } from "@/lib/database";
import { guard } from "@/lib/route-guard";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { projectAccess } from "@/lib/security/project-access";

export const GET = guard("ai/connections.GET", async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "ai-connections", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Sign in to select an AI provider." }, { status: 401 });
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    let ids: string[];
    if (projectId) {
      const project = await projectAccess(databaseConfig(), projectId, actor.id);
      if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
      ids = project.organization_id ? [project.organization_id] : [];
    } else {
      const members = await database<{ organization_id: string }[]>(`organization_members?select=organization_id&user_id=eq.${encodeURIComponent(actor.id)}`);
      ids = members.map(row => row.organization_id);
    }
    const credentials = ids.length ? await database(`provider_credentials?select=id,organization_id,provider,display_name,model_allowlist,scopes,created_at&status=eq.active&organization_id=in.(${ids.join(",")})&order=created_at.desc`) : [];
    return Response.json({ credentials }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to load saved AI providers." }, { status: 503 });
  }
});

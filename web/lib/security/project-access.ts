/** Resolve access server-side before using the service role for project-scoped data. */
export type ProjectAccess = {
  id: string;
  owner_id: string;
  organization_id: string | null;
  verified_at: string | null;
  role: string;
};
type Config = { url: string; key: string };
function headers(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}
export async function projectAccess(config: Config, projectId: string, actorId: string): Promise<ProjectAccess | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) return null;
  const projectResponse = await fetch(
    `${config.url}/rest/v1/projects?select=id,owner_id,organization_id,verified_at&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    { headers: headers(config.key), cache: "no-store" },
  );
  if (!projectResponse.ok) return null;
  const project = (await projectResponse.json() as Array<Omit<ProjectAccess, "role">>)[0];
  if (!project) return null;
  if (project.owner_id === actorId) return { ...project, role: "owner" };
  if (!project.organization_id) return null;
  const memberResponse = await fetch(
    `${config.url}/rest/v1/organization_members?select=role&organization_id=eq.${encodeURIComponent(project.organization_id)}&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { headers: headers(config.key), cache: "no-store" },
  );
  if (!memberResponse.ok) return null;
  const member = (await memberResponse.json() as Array<{ role: string }>)[0];
  return member?.role ? { ...project, role: member.role } : null;
}
export function canManageProject(role: string): boolean {
  return ["owner", "admin", "developer"].includes(role);
}

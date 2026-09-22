import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
import { jsonOrError, supabaseRest } from "@/lib/supabase-rest";

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "organizations-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  try {
    const response = await supabaseRest(`/rest/v1/organization_members?select=role,organizations(id,name,slug,created_at)&user_id=eq.${actor!.id}`, { accessToken: actor!.accessToken });
    return Response.json({ memberships: await jsonOrError(response) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load organizations." }, { status: 502 }); }
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "organizations-create", limit: 8, windowMs: 300_000, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  let body: { name?: string; slug?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const name = (body.name || "").trim().slice(0, 80);
  const slug = (body.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  if (name.length < 2 || slug.length < 2) return Response.json({ error: "Enter a valid organization name." }, { status: 400 });
  try {
    const organizationResponse = await supabaseRest("/rest/v1/organizations", {
      serviceRole: true, method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name, slug, created_by: actor!.id }),
    });
    const organizations = await jsonOrError(organizationResponse); const organization = organizations[0];
    try {
      const membershipResponse = await supabaseRest("/rest/v1/organization_members", {
        serviceRole: true, method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ organization_id: organization.id, user_id: actor!.id, role: "owner" }),
      });
      await jsonOrError(membershipResponse);
    } catch (error) {
      await supabaseRest(`/rest/v1/organizations?id=eq.${organization.id}`, { serviceRole: true, method: "DELETE" }).catch(() => null);
      throw error;
    }
    return Response.json({ organization }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create organization." }, { status: 400 }); }
}

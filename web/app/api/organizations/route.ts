import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

type Organization = { id: string; name: string; slug: string; created_at: string };
type Membership = { role: string; organizations: Organization | null };

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function headers(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "organizations-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const config = configuration();
  if (!config) return Response.json({ error: "Organization service is not configured." }, { status: 503 });
  const endpoint = `${config.url}/rest/v1/organization_members?select=role,organizations(id,name,slug,created_at)&user_id=eq.${encodeURIComponent(actor.id)}`;
  const upstream = await fetch(endpoint, { headers: headers(config.serviceKey), cache: "no-store" });
  if (!upstream.ok) return Response.json({ error: "Unable to load organizations." }, { status: 502 });
  const memberships = await upstream.json() as Membership[];
  return Response.json({ memberships }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "organizations-create", limit: 8, windowMs: 300_000, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
  const config = configuration();
  if (!config) return Response.json({ error: "Organization service is not configured." }, { status: 503 });
  let body: { name?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const name = (body.name || "").trim().slice(0, 80);
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  if (name.length < 2 || baseSlug.length < 2) return Response.json({ error: "Enter a valid workspace name." }, { status: 400 });
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
  const organizationResponse = await fetch(`${config.url}/rest/v1/organizations`, {
    method: "POST", headers: headers(config.serviceKey, "return=representation"),
    body: JSON.stringify({ name, slug, created_by: actor.id }), cache: "no-store",
  });
  if (!organizationResponse.ok) return Response.json({ error: "Unable to create workspace." }, { status: 400 });
  const organizations = await organizationResponse.json() as Organization[];
  const organization = organizations[0];
  if (!organization) return Response.json({ error: "Workspace creation returned no record." }, { status: 502 });
  const membershipResponse = await fetch(`${config.url}/rest/v1/organization_members`, {
    method: "POST", headers: headers(config.serviceKey, "return=minimal"),
    body: JSON.stringify({ organization_id: organization.id, user_id: actor.id, role: "owner" }), cache: "no-store",
  });
  if (!membershipResponse.ok) {
    await fetch(`${config.url}/rest/v1/organizations?id=eq.${organization.id}`, { method: "DELETE", headers: headers(config.serviceKey), cache: "no-store" });
    return Response.json({ error: "Unable to create workspace membership." }, { status: 502 });
  }
  return Response.json({ organization }, { status: 201 });
}

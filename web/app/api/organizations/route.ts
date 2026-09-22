import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "organizations-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  return Response.json({ memberships: [], status: "onboarding_pending" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "organizations-create", limit: 8, windowMs: 300_000, maxBodyBytes: 8_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  return Response.json({ error: "Organization provisioning is being activated in the next foundation increment." }, { status: 503 });
}

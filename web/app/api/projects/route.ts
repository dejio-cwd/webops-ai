import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export async function GET(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-read", limit: 60, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  return Response.json({ projects: [], status: "onboarding_pending" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const actor = await guardApiRequest(request, { bucket: "projects-create", limit: 12, windowMs: 300_000, maxBodyBytes: 12_000, requireAuth: true });
  if (isGuardResponse(actor)) return actor;
  return Response.json({ error: "Project provisioning is being activated in the next foundation increment." }, { status: 503 });
}

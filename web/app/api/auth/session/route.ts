import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";
export async function GET(request: Request) {
  try {
    const actor = await guardApiRequest(request, { bucket: "auth-session", limit: 60, requireAuth: true });
    if (isGuardResponse(actor)) return actor;
    return Response.json({ user: actor && { id: actor.id, email: actor.email } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Session service unavailable." }, { status: 503 });
  }
}

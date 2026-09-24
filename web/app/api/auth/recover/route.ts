import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "auth-recover", limit: 4, windowMs: 900_000, maxBodyBytes: 4_000, requireAuth: false });
  if (isGuardResponse(guard)) return guard;
  let body: { email?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  const redirectTo = new URL("/reset-password", request.url).toString();
  await fetch(`${url.replace(/\/$/, "")}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email }), cache: "no-store",
  });
  return Response.json({ ok: true, message: "If an account exists, a recovery email has been sent." });
}

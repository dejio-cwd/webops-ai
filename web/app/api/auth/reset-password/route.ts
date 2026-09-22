import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "auth-reset", limit: 6, windowMs: 900_000, maxBodyBytes: 8_000, requireAuth: false });
  if (isGuardResponse(guard)) return guard;
  let body: { accessToken?: string; password?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.accessToken || !body.password || body.password.length < 12) return Response.json({ error: "Use a password of at least 12 characters." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  const upstream = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    method: "PUT", headers: { apikey: key, Authorization: `Bearer ${body.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: body.password }), cache: "no-store",
  });
  const data = await upstream.json();
  if (!upstream.ok) return Response.json({ error: data.msg || data.error_description || "The recovery link is invalid or expired." }, { status: 400 });
  return Response.json({ ok: true });
}

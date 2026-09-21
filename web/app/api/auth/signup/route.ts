import { NextResponse } from "next/server";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "auth-signup", limit: 4, windowMs: 300_000, maxBodyBytes: 8_000, requireAuth: false });
  if (isGuardResponse(guard)) return guard;
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.email || !body.password || body.password.length < 12) return NextResponse.json({ error: "Use a valid email and a password of at least 12 characters." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
  const upstream = await fetch(`${url.replace(/\/$/, "")}/auth/v1/signup`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await upstream.json();
  if (!upstream.ok) return NextResponse.json({ error: data.error_description || data.msg || "Account creation failed." }, { status: 400 });
  const response = NextResponse.json({ user: { id: data.user?.id, email: data.user?.email }, confirmationRequired: !data.access_token }, { status: 201 });
  if (data.access_token) {
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("webops_access", data.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.expires_in || 3600 });
    response.cookies.set("webops_refresh", data.refresh_token, { httpOnly: true, secure, sameSite: "strict", path: "/api/auth", maxAge: 60 * 60 * 24 * 30 });
  }
  return response;
}

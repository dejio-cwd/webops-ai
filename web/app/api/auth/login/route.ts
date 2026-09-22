import { NextResponse } from "next/server";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "auth-login", limit: 8, maxBodyBytes: 8_000, requireAuth: false });
  if (isGuardResponse(guard)) return guard;
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.email || !body.password || body.password.length < 8) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
  const upstream = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await upstream.json();
  if (!upstream.ok) return NextResponse.json({ error: data.error_description || data.msg || "Sign in failed." }, { status: 401 });
  const response = NextResponse.json({ user: { id: data.user?.id, email: data.user?.email }, expiresIn: data.expires_in, next: "/workspace" });
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("webops_access", data.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.expires_in || 3600 });
  response.cookies.set("webops_refresh", data.refresh_token, { httpOnly: true, secure, sameSite: "strict", path: "/api/auth", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

import { NextResponse } from "next/server";
import { guardApiRequest, isGuardResponse } from "@/lib/security/api-guard";

function cookie(request: Request, name: string) {
  const entry = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

export async function POST(request: Request) {
  const guard = await guardApiRequest(request, { bucket: "auth-refresh", limit: 20, windowMs: 300_000, maxBodyBytes: 1_000, requireAuth: false });
  if (isGuardResponse(guard)) return guard;
  const refreshToken = cookie(request, "webops_refresh");
  if (!refreshToken) return NextResponse.json({ error: "Refresh session required." }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
  try {
    const upstream = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }), cache: "no-store",
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !data.access_token) {
      const expired = NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
      expired.cookies.set("webops_access", "", { httpOnly: true, maxAge: 0, path: "/" });
      expired.cookies.set("webops_refresh", "", { httpOnly: true, maxAge: 0, path: "/api/auth" });
      return expired;
    }
    const secure = process.env.NODE_ENV === "production";
    const response = NextResponse.json({ user: { id: data.user?.id, email: data.user?.email }, expiresIn: data.expires_in });
    response.cookies.set("webops_access", data.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: data.expires_in || 3600 });
    response.cookies.set("webops_refresh", data.refresh_token || refreshToken, { httpOnly: true, secure, sameSite: "strict", path: "/api/auth", maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch {
    // Never leak a Vercel 500 from a transient Supabase Auth reachability blip.
    return NextResponse.json({ error: "Session refresh unavailable. Please sign in again." }, { status: 503 });
  }
}

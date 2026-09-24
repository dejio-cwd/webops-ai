import { NextResponse } from "next/server";

function cookie(request: Request, name: string) {
  const entry = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

export async function POST(request: Request) {
  const accessToken = cookie(request, "webops_access");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (accessToken && url && key) {
    await fetch(`${url.replace(/\/$/, "")}/auth/v1/logout`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${accessToken}` }, cache: "no-store" }).catch(() => null);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("webops_access", "", { httpOnly: true, maxAge: 0, path: "/" });
  response.cookies.set("webops_refresh", "", { httpOnly: true, maxAge: 0, path: "/api/auth" });
  return response;
}

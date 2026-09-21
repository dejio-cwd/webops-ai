import { NextResponse } from "next/server";
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("webops_access", "", { httpOnly: true, maxAge: 0, path: "/" });
  response.cookies.set("webops_refresh", "", { httpOnly: true, maxAge: 0, path: "/api/auth" });
  return response;
}

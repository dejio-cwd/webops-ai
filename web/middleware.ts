import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const authFree = path.startsWith("/sign-in") || path.startsWith("/api/auth") || path.startsWith("/api/health");
  if (process.env.SECURITY_ENFORCE_AUTH === "true" && !authFree && !request.cookies.get("webops_access")) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const signIn = new URL("/sign-in", request.url); signIn.searchParams.set("next", path); return NextResponse.redirect(signIn);
  }
  const response = NextResponse.next();
  response.headers.set("X-Request-Id", request.headers.get("x-request-id") || crypto.randomUUID());
  response.headers.set("X-Content-Type-Options", "nosniff"); response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "SAMEORIGIN"); response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin"); response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'; form-action 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https:; upgrade-insecure-requests");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "webops-ai",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || "development",
    authEnforced: process.env.SECURITY_ENFORCE_AUTH === "true",
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}

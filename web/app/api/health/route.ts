export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKeyConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return Response.json({
    status: "ok",
    service: "webops-ai",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || "development",
    authEnforced: process.env.SECURITY_ENFORCE_AUTH === "true",
    configuration: {
      supabaseUrlConfigured,
      supabaseAnonKeyConfigured,
      serviceRoleConfigured,
      authenticationReady: supabaseUrlConfigured && supabaseAnonKeyConfigured,
    },
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}

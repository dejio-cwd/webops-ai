export const dynamic = "force-dynamic";

async function tableReady(baseUrl: string, serviceKey: string, table: string) {
  try {
    const response = await fetch(
      `${baseUrl}/rest/v1/${table}?select=*&limit=0`,
      {
        method: "GET",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        cache: "no-store",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const supabaseUrlConfigured = Boolean(supabaseUrl);
  const supabaseAnonKeyConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const serviceRoleConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  // Match the vault's minimum key requirement without exposing the key or its length.
  const credentialVaultReady = (process.env.CREDENTIAL_ENCRYPTION_KEY || "").length >= 32;
  const migrationTables = [
    "organizations",
    "projects",
    "provider_credentials",
    "organization_invitations",
    "audit_runs",
    "fix_records",
    "monitoring_configs",
    "monitoring_alerts",
  ];
  const databaseReadiness =
    supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? Object.fromEntries(
          await Promise.all(
            migrationTables.map(async (table) => [
              table,
              await tableReady(
                supabaseUrl,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
                table,
              ),
            ]),
          ),
        )
      : undefined;
  const databaseReady = databaseReadiness
    ? Object.values(databaseReadiness).every(Boolean)
    : false;
  return Response.json(
    {
      status: databaseReady && credentialVaultReady ? "ok" : "degraded",
      service: "webops-ai",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || "development",
      authEnforced: process.env.SECURITY_ENFORCE_AUTH === "true",
      configuration: {
        supabaseUrlConfigured,
        supabaseAnonKeyConfigured,
        serviceRoleConfigured,
        authenticationReady: supabaseUrlConfigured && supabaseAnonKeyConfigured,
        credentialVaultReady,
      },
      database: {
        configured: Boolean(databaseReadiness),
        requiredTablesReady: databaseReady,
        tables: databaseReadiness,
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

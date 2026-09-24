import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");

test("health endpoint exposes readiness indicators without secret values", () => {
  for (const table of ["organizations", "projects", "provider_credentials", "organization_invitations", "audit_runs", "fix_records", "monitoring_configs", "monitoring_alerts"]) assert.match(source, new RegExp(table));
  assert.match(source, /requiredTablesReady/);
  assert.doesNotMatch(source, /process\.env\.(SUPABASE_SERVICE_ROLE_KEY|CREDENTIAL_ENCRYPTION_KEY|CRON_SECRET)\s*[,}]/);
});

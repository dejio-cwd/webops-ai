import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
const code = stripTypeScriptTypes(readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8"));
const { GET } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
globalThis.fetch = async () => Response.json([]);
test("health flags unusable vault key without revealing its contents", async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = "short-placeholder";
  const result = await (await GET()).json();
  assert.equal(result.status, "degraded");
  assert.equal(result.configuration.credentialVaultReady, false);
  assert.equal(JSON.stringify(result).includes("short-placeholder"), false);
});
test("health reports vault ready only when the vault minimum is satisfied", async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = "test-only-32-character-placeholder-value";
  const result = await (await GET()).json();
  assert.equal(result.status, "ok");
  assert.equal(result.configuration.credentialVaultReady, true);
  assert.equal(result.configuration.credentialVaultKeyState, "meets_minimum");
  assert.equal(result.database.requiredTablesReady, true);
});

test("health distinguishes absent variable from a short runtime value", async () => {
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "phase-1-production-foundation";
  let result = await (await GET()).json();
  assert.equal(result.configuration.credentialVaultKeyState, "missing");
  assert.equal(result.deployment.target, "preview");
  assert.equal(result.deployment.branch, "phase-1-production-foundation");
  process.env.CREDENTIAL_ENCRYPTION_KEY = "";
  result = await (await GET()).json();
  assert.equal(result.configuration.credentialVaultKeyState, "empty");
  process.env.CREDENTIAL_ENCRYPTION_KEY = "short-placeholder";
  result = await (await GET()).json();
  assert.equal(result.configuration.credentialVaultKeyState, "below_minimum");
  assert.equal(JSON.stringify(result).includes("short-placeholder"), false);
});

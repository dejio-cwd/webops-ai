import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
const source = readFileSync(new URL("../app/api/provider-credentials/route.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
const prefix = 'const guardApiRequest = async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }); const isGuardResponse = () => false; const encryptSecret = s => `encrypted:${s}`; const validateAiCredentialEndpoint = async () => {};\n';
const { PATCH, DELETE, POST } = await import(`data:text/javascript;base64,${Buffer.from(prefix + stripTypeScriptTypes(source)).toString("base64")}`);
const org = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const request = (method, body) => new Request("https://app.invalid/api/provider-credentials", { method, body: JSON.stringify({ organizationId: org, credentialId: id, ...body }) });
function setup(rows = []) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (url.includes("organization_members?")) return Response.json([{ role: "owner" }]);
    if (url.includes("provider_credentials") && init.method) return Response.json(rows);
    if (url.endsWith("/audit_events")) return Response.json({});
    throw Error(`Unexpected fetch ${url}`);
  };
  return calls;
}
test("rotation with zero affected rows returns 404, not a success or audit event", async () => {
  const calls = setup([]), r = await PATCH(request("PATCH", { apiKey: "synthetic-rotation" }));
  assert.equal(r.status, 404);
  assert.equal(calls.some(c => c.url.endsWith("/audit_events")), false);
  assert.equal(calls.find(c => c.method === "PATCH")?.url.includes(`organization_id=eq.${org}`), true);
});
test("revoke with zero affected rows returns 404", async () => {
  const calls = setup([]), r = await DELETE(request("DELETE"));
  assert.equal(r.status, 404);
  assert.equal(calls.some(c => c.url.endsWith("/audit_events")), false);
});
test("successful rotation and revocation use returned row before auditing", async () => {
  const calls = setup([{ id }]);
  const rotated = await PATCH(request("PATCH", { apiKey: "synthetic-rotation" }));
  assert.equal(rotated.status, 200);
  const revoked = await DELETE(request("DELETE"));
  assert.equal(revoked.status, 200);
  assert.equal(calls.filter(c => c.url.endsWith("/audit_events")).length, 2);
});
test("creation without a returned row is not reported as success", async () => {
  setup([]);
  const r = await POST(request("POST", { provider: "openai", displayName: "QA", apiKey: "synthetic-create" }));
  assert.equal(r.status, 502);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = readFileSync(new URL("../app/api/fixes/verify/route.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
const prefix = [
  'const guardApiRequest = async () => ({ id: actor });',
  'const isGuardResponse = () => false;',
  'const AUDIT_ENGINE_VERSION = "test";',
  'const runAudit = (...a) => globalThis.__audit(...a);',
  'const verificationCoverage = (...a) => globalThis.__cov(...a);',
  'const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";',
  '',
].join("\n");
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(prefix + stripTypeScriptTypes(source)).toString("base64")}`);

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectId = "11111111-1111-4111-8111-111111111111";
const auditId = "audit-1";
const opportunityId = "OPP-1";
const followup = { auditId: "audit-2", version: "1.1.1", crawl: { truncated: false, pagesCrawled: 1 }, findings: [], opportunities: [], health: { overall: 90 } };
const json = (data, status = 200) => Response.json(data, { status });
const request = (body) => new Request("https://app.invalid/api/fixes/verify", { method: "POST", body: JSON.stringify(body) });

function setup({ fixStatus = "ready", baseline = true, coverage = { valid: true, reason: "clear" }, configured = true } = {}) {
  if (configured) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  const calls = [];
  let crawls = 0;
  globalThis.__audit = async (_target, options) => { assert.equal(options.respectRobots, true); crawls++; return followup; };
  globalThis.__cov = () => coverage;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); const method = init.method || "GET";
    calls.push({ url, method, body: init.body });
    if (url.includes("/projects?") && url.includes("select=id,owner_id")) return json([{ id: projectId, owner_id: actor, organization_id: "org-1" }]);
    if (url.includes("/audit_runs?") && method === "GET") return json(baseline ? [{ owner_id: actor, project_id: projectId, url: "https://example.com", created_at: "2026-09-22T00:00:00Z", status: "completed", result: { crawl: { origin: "https://example.com" }, opportunities: [{ id: opportunityId, affectedUrls: ["https://example.com/"] }] } }] : []);
    if (url.includes("/fix_records?select=status,title")) return json([{ status: fixStatus, title: "Fix" }]);
    if (url.endsWith("/audit_runs") && method === "POST") return json({}, 201);
    if (url.includes("/fix_records?") && method === "PATCH") return json([{ id: "fix-1" }]);
    if (url.includes("/projects?") && url.includes("select=organization_id")) return json([{ organization_id: "org-1" }]);
    if (url.endsWith("/audit_events") && method === "POST") return json({}, 201);
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
  return { calls: () => calls, crawls: () => crawls };
}
const base = { auditId, projectId, opportunityId };

test("re-crawl verification marks a ready fix verified only when the finding is gone", async () => {
  const ctx = setup({ coverage: { valid: true, reason: "All affected URLs recrawled without the finding." } });
  const response = await POST(request(base));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.verified, true);
  assert.equal(ctx.crawls(), 1);
  const patch = ctx.calls().find((c) => c.url.includes("/fix_records?") && c.method === "PATCH");
  assert.ok(patch, "expected a fix_records status update");
  assert.equal(JSON.parse(patch.body).status, "verified");
  assert.ok(ctx.calls().some((c) => c.url.endsWith("/audit_runs") && c.method === "POST"), "expected the verification crawl to be persisted");
});

test("re-crawl that still finds the issue does not mark verified", async () => {
  const ctx = setup({ coverage: { valid: false, reason: "The finding still appears on an affected URL." } });
  const response = await POST(request(base));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.verified, false);
  assert.equal(ctx.crawls(), 1);
  assert.equal(ctx.calls().some((c) => c.url.includes("/fix_records?") && c.method === "PATCH"), false);
});

test("a fix that is not ready cannot be auto-verified and is not crawled", async () => {
  const ctx = setup({ fixStatus: "draft" });
  const response = await POST(request(base));
  assert.equal(response.status, 409);
  assert.equal(ctx.crawls(), 0);
});

test("an out-of-scope baseline audit is rejected before crawling", async () => {
  const ctx = setup({ baseline: false });
  const response = await POST(request(base));
  assert.equal(response.status, 403);
  assert.equal(ctx.crawls(), 0);
});

test("verification is gated off when the datastore is not configured", async () => {
  setup({ configured: false });
  const response = await POST(request(base));
  assert.equal(response.status, 503);
});

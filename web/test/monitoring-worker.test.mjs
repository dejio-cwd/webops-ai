import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = readFileSync(new URL("../app/api/monitoring/run/route.ts", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");
const code = 'const runAudit = (...args) => globalThis.__testAudit(...args);\nconst compareAudits = (...args) => globalThis.__testCompare(...args);\n' + stripTypeScriptTypes(source);
const { GET } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const monitor = { id: "monitor-1", owner_id: "owner-1", project_id: "project-1", cadence: "daily", next_run_at: "2026-09-22T00:00:00.000Z" };
const audit = { auditId: "audit-1", version: "1.1.1", crawl: { truncated: false, pagesCrawled: 1 }, findings: [], opportunities: [], health: { overall: 82 } };
const json = (data, status = 200) => Response.json(data, { status });

async function runCase({ verified = true, claim = [{ id: monitor.id }], saveStatus = 201 } = {}) {
  const calls = [];
  let crawls = 0;
  globalThis.__testAudit = async (_url, options) => {
    assert.equal(options.respectRobots, true);
    crawls++;
    return audit;
  };
  globalThis.__testCompare = () => ({ regressions: [] });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (url.includes("monitoring_configs?") && !init.method) return json([monitor]);
    if (url.includes("projects?")) return json([{ domain: "example.com", verified_at: verified ? "2026-09-22T00:00:00Z" : null }]);
    if (url.includes("monitoring_configs?") && init.method === "PATCH") {
      if (url.includes("enabled=eq.true")) return json(claim);
      return json(init.headers.Prefer ? [{ id: monitor.id }] : []);
    }
    if (url.includes("audit_runs?") && !init.method) return json([]);
    if (url.endsWith("/audit_runs") && init.method === "POST") return json({}, saveStatus);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  process.env.CRON_SECRET = "test-only-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
  const response = await GET(new Request("https://app.invalid/api/monitoring/run", { headers: { authorization: "Bearer test-only-secret" } }));
  return { response, result: await response.json(), calls, crawls };
}

test("scheduled audits require verified ownership and obey robots policy", async () => {
  const blocked = await runCase({ verified: false });
  assert.equal(blocked.result.results[0].status, "verification_required");
  assert.equal(blocked.crawls, 0);
  assert.equal(blocked.calls.some(c => c.method === "PATCH"), false);
  const success = await runCase();
  assert.equal(success.result.results[0].status, "completed");
  assert.equal(success.crawls, 1);
  assert.equal(success.calls.some(c => c.url.includes("enabled=eq.true&next_run_at=eq.") && c.method === "PATCH"), true);
  assert.equal(success.calls.filter(c => c.method === "POST" && c.url.endsWith("/audit_runs")).length, 1);
});

test("concurrent claim loss does not crawl", async () => {
  const result = await runCase({ claim: [] });
  assert.equal(result.result.results[0].status, "already_claimed");
  assert.equal(result.crawls, 0);
});

test("failed evidence persistence is not reported as completed", async () => {
  const result = await runCase({ saveStatus: 500 });
  assert.equal(result.result.results[0].status, "failed");
  assert.equal(result.calls.some(c => c.method === "PATCH" && String(c.body).includes("next_run_at") && !c.url.includes("enabled=eq.true")), true);
});

test("scheduler denies requests without the configured secret", async () => {
  process.env.CRON_SECRET = "test-only-secret";
  const response = await GET(new Request("https://app.invalid/api/monitoring/run"));
  assert.equal(response.status, 401);
});

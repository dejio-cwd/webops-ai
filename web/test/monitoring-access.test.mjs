import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const load = async (path, prefix = "") => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  return import(`data:text/javascript;base64,${Buffer.from(prefix + stripTypeScriptTypes(source)).toString("base64")}`);
};
const access = await load("../lib/security/project-access.ts");
globalThis.__access = access;
const guard = 'const guardApiRequest = async request => ({ id: request.headers.get("x-test-actor") }); const isGuardResponse = () => false; const { projectAccess, canManageProject } = globalThis.__access; const guard = (_name, handler) => handler;\n';
const monitoring = await load("../app/api/monitoring/route.ts", guard);
const alerts = await load("../app/api/monitoring/alerts/route.ts", guard);
const projectId = "11111111-1111-4111-8111-111111111111";
const otherProject = "22222222-2222-4222-8222-222222222222";
const respond = data => Response.json(data);
function setup(role = "viewer", verified = true) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (url.includes("/projects?")) return respond([{ id: url.includes(otherProject) ? otherProject : projectId, owner_id: "owner-1", organization_id: "org-1", verified_at: verified ? "2026-09-22T00:00:00Z" : null }]);
    if (url.includes("/organization_members?")) return respond(role ? [{ role }] : []);
    if (url.includes("/monitoring_configs?")) return respond([{ project_id: projectId, owner_id: "owner-1" }]);
    if (url.includes("/monitoring_configs?on_conflict=owner_id,project_id") && init.method === "POST") return respond([{ project_id: projectId }]);
    if (url.includes("/monitoring_alerts?select=project_id")) return respond([{ project_id: projectId }]);
    if (url.includes("/monitoring_alerts?") && init.method === "PATCH") return respond([{ id: "alert-1" }]);
    if (url.includes("/monitoring_alerts?")) return respond([{ project_id: projectId, owner_id: "owner-1" }]);
    throw Error(`Unexpected fetch: ${url}`);
  };
  return calls;
}
const request = (path, actor = "viewer-2", method = "GET", body) => new Request(`https://app.invalid${path}`, { method, headers: { "x-test-actor": actor }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("viewer reads team monitoring and alerts but cannot update them", async () => {
  const calls = setup();
  const monitors = await monitoring.GET(request(`/api/monitoring?projectId=${projectId}`));
  assert.equal(monitors.status, 200);
  assert.equal((await monitors.json()).monitors.length, 1);
  const alertList = await alerts.GET(request(`/api/monitoring/alerts?projectId=${projectId}`));
  assert.equal(alertList.status, 200);
  assert.equal((await alertList.json()).alerts.length, 1);
  const update = await alerts.PATCH(request("/api/monitoring/alerts", "viewer-2", "PATCH", { alertId: "alert-1", status: "resolved" }));
  assert.equal(update.status, 403);
  assert.equal(calls.some(c => c.method === "PATCH"), false);
  const create = await monitoring.POST(request("/api/monitoring", "viewer-2", "POST", { projectId, cadence: "daily", enabled: false }));
  assert.equal(create.status, 403);
  assert.equal(calls.some(c => c.url.includes("/monitoring_configs") && c.method === "POST"), false);
});

test("nonmembers cannot read another tenant's project data", async () => {
  setup(null);
  assert.equal((await monitoring.GET(request(`/api/monitoring?projectId=${otherProject}`))).status, 403);
  assert.equal((await alerts.GET(request(`/api/monitoring/alerts?projectId=${otherProject}`))).status, 403);
});

test("unverified projects cannot enable scheduled monitoring", async () => {
  const calls = setup("developer", false);
  const response = await monitoring.POST(request("/api/monitoring", "developer-2", "POST", { projectId, cadence: "daily", enabled: true }));
  assert.equal(response.status, 409);
  assert.equal(calls.some(c => c.method === "POST"), false);
});

test("developer can manage canonical owner monitoring and acknowledge alerts", async () => {
  const calls = setup("developer");
  const created = await monitoring.POST(request("/api/monitoring", "developer-2", "POST", { projectId, cadence: "daily", enabled: false }));
  assert.equal(created.status, 200);
  const save = calls.find(c => c.url.includes("/monitoring_configs?on_conflict=owner_id,project_id") && c.method === "POST");
  assert.equal(JSON.parse(save.body).owner_id, "owner-1");
  assert.equal(save.url.includes("on_conflict=owner_id,project_id"), true);
  const updated = await alerts.PATCH(request("/api/monitoring/alerts", "developer-2", "PATCH", { alertId: "alert-1", status: "acknowledged" }));
  assert.equal(updated.status, 200);
});

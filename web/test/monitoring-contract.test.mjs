import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const worker = await readFile(new URL("../app/api/monitoring/run/route.ts", import.meta.url), "utf8");
const alerts = await readFile(new URL("../app/api/monitoring/alerts/route.ts", import.meta.url), "utf8");

test("monitoring worker requires bearer CRON_SECRET", () => {
  assert.match(worker, /process\.env\.CRON_SECRET/);
  assert.match(worker, /authorization.*Bearer/si);
  assert.match(worker, /status: 401/);
});

test("monitoring worker persists scheduled audits and alerts", () => {
  assert.match(worker, /launchAudit/);
  assert.match(worker, /monitoring_alerts/);
  assert.match(worker, /status: "queued"/);
  assert.match(worker, /kind: "failure"/);
});

test("monitoring alerts API validates owner-scoped status transitions", () => {
  assert.match(alerts, /owner_id=eq/);
  assert.match(alerts, /acknowledged/);
  assert.match(alerts, /resolved/);
  assert.match(alerts, /status.*required/si);
});

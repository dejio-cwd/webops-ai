import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const source = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
test("monitoring settings load by active project and disabled state is preserved", () => {
  assert.match(source, /apiFetch\(`\/api\/monitoring\?projectId=\$\{encodeURIComponent\(projectId\)\}`\)/);
  assert.match(source, /setMonitorEnabled\(monitor\.enabled\)/);
  assert.match(source, /setMonitorCadence\(monitor\.cadence\)/);
  assert.match(source, /setMonitorAlerts\(data\.alerts \|\| \[\]\)/);
  assert.match(source, /Monitoring paused\./);
});

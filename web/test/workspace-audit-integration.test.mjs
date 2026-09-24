import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const source = await readFile(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
test("workspace embeds the API-backed audit workbench instead of linking users to legacy audit routes", () => {
  assert.match(source, /AuditWorkbench/);
  assert.match(source, /active === "Audits"/);
  assert.doesNotMatch(source, /\/audit\?url=/);
});

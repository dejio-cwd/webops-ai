import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const route = readFileSync(new URL("../app/api/fixes/route.ts", import.meta.url), "utf8");
test("Fix Center upsert targets its unique owner/audit/opportunity key", () => {
  assert.match(route, /fix_records\?on_conflict=owner_id,audit_id,opportunity_id/);
  assert.match(route, /resolution=merge-duplicates,return=representation/);
  assert.match(route, /if \(!fix\) return Response\.json\(\{ error: "Fix save returned no record\." \}, \{ status: 502 \}\)/);
});

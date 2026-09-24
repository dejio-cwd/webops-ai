import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");

test("project OR conditions use PostgREST's dotted filter grammar", () => {
  assert.match(route, /owner_id\.eq\.\$\{encodeURIComponent\(actor\.id\)\}/);
  assert.match(route, /organization_id\.in\.\(\$\{organizationIds\.join\(","\)\}\)/);
  assert.doesNotMatch(route, /owner_id=eq\.|organization_id=in\./);
});

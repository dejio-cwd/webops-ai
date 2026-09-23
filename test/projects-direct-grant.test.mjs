import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const sql = readFileSync(new URL("../supabase/migrations/20260923_phase1_projects_server_only.sql", import.meta.url), "utf8");
test("projects are not directly granted to browser database roles", () => {
  assert.match(sql, /revoke all on table public\.projects from anon, authenticated;/i);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/i);
});

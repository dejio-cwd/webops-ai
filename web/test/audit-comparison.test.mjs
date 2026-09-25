import assert from "node:assert/strict";
import { test } from "node:test";
import { compareAudits } from "../lib/audit-comparison.ts";

const base = (auditId, score, findings, pagesCrawled = 1) => ({
  auditId,
  version: "1.0.0",
  capturedAt: new Date().toISOString(),
  crawl: { pagesCrawled, truncated: false },
  health: { overall: score },
  findings,
  pages: ["https://example.com/old", "https://example.com/keep", "https://example.com/new", "https://example.com"].map(url => ({url, finalUrl:url, requestedUrl:url, ok:true})),
});
const finding = (ruleId, url, severity = "medium") => ({ ruleId, ruleVersion: "1", category: "seo", severity, title: ruleId, detail: "detail", why: "why", recommendation: "recommendation", url, evidence: "evidence" });

test("audit comparison classifies new, resolved and persistent findings", () => {
  const before = base("before", 80, [finding("old", "https://example.com/old"), finding("keep", "https://example.com/keep")], 2);
  const after = base("after", 72, [finding("keep", "https://example.com/keep"), finding("new", "https://example.com/new", "high")], 3);
  const result = compareAudits(before, after);
  assert.equal(result.healthScoreDelta, -8);
  assert.equal(result.pagesCrawledDelta, 1);
  assert.deepEqual(result.newFindings.map((item) => item.ruleId), ["new"]);
  assert.deepEqual(result.resolvedFindings.map((item) => item.ruleId), ["old"]);
  assert.deepEqual(result.persistentFindings.map((item) => item.ruleId), ["keep"]);
  assert.deepEqual(result.regressions.map((item) => item.ruleId), ["new"]);
});

test("comparison key distinguishes evidence instances on the same URL", () => {
  const before = base("before", 90, [finding("same-rule", "https://example.com", "low")]);
  const after = base("after", 90, [ { ...finding("same-rule", "https://example.com", "low"), evidence: "different" } ]);
  const result = compareAudits(before, after);
  assert.equal(result.newFindings.length, 1);
  assert.equal(result.resolvedFindings.length, 1);
  assert.equal(result.persistentFindings.length, 0);
});

test("partial coverage never marks unseen findings resolved", () => {
 const before=base("a",50,[finding("old","https://example.com/unseen")]);
 const after=base("b",90,[]);
 const result=compareAudits(before,after);
 assert.equal(result.resolvedFindings.length,0);
 assert.equal(result.unverifiedFindings.length,1);
 after.crawl.truncated=true;
 after.pages.push({url:"https://example.com/unseen",ok:true});
 assert.equal(compareAudits(before,after).resolvedFindings.length,0);
});

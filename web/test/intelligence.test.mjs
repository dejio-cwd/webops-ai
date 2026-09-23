import assert from "node:assert/strict";
import { test } from "node:test";
import { runIntelligenceRules } from "../lib/intelligence.ts";

const page = (url, overrides = {}) => ({
  url, requestedUrl: url, status: 200, ok: true, redirected: false,
  contentType: "text/html", indexable: true, links: [], images: [],
  canonical: null, hreflang: [], findings: [], ...overrides,
});
const link = (href) => ({ href, internal: true });

test("reports only observed noindex and redirect targets, without duplicates", () => {
  const origin = page("https://site.example/", { links: [
    link("https://site.example/hidden"), link("https://site.example/hidden"),
    link("https://site.example/old"), link("https://site.example/unfetched"),
  ] });
  const hidden = page("https://site.example/hidden", { indexable: false });
  const moved = page("https://site.example/new", {
    requestedUrl: "https://site.example/old", redirected: true,
  });
  const result = runIntelligenceRules([origin, hidden, moved]);
  assert.deepEqual(result.map((f) => f.ruleId), ["LINK-NOINDEX-TARGET", "LINK-REDIRECT-TARGET"]);
  assert.equal(result[0].url, origin.url);
  assert.equal(result[0].evidence, hidden.url);
  assert.equal(origin.findings.length, 2);
});

test("checks observed failed canonicals but not uncrawled external targets", () => {
  const source = page("https://site.example/a", { canonical: "https://site.example/missing" });
  const missing = page("https://site.example/missing", { ok: false, status: 404 });
  assert.equal(runIntelligenceRules([source])[0], undefined);
  const result = runIntelligenceRules([source, missing]);
  assert.deepEqual(result.map((f) => f.ruleId), ["CANONICAL-BROKEN-TARGET"]);
});

test("reports mixed images and conflicting language targets, not repeated identical alternates", () => {
  const source = page("https://site.example", {
    images: [{ src: "http://cdn.example/p.png" }, { src: "http://cdn.example/p.png" }],
    hreflang: [
      { lang: "en", href: "https://site.example/a" },
      { lang: "EN", href: "https://site.example/a" },
      { lang: "en", href: "https://site.example/b" },
    ],
  });
  assert.deepEqual(runIntelligenceRules([source]).map((f) => f.ruleId),
    ["IMG-MIXED-CONTENT", "HREFLANG-CONFLICT"]);
  assert.equal(source.findings[0].evidence, "http://cdn.example/p.png");
});

test("skips failed and non-HTML source pages", () => {
  const source = page("https://site.example", { ok: false, images: [{ src: "http://cdn.example/a" }] });
  const document = page("https://site.example/file", { contentType: "application/pdf", images: [{ src: "http://cdn.example/b" }] });
  assert.deepEqual(runIntelligenceRules([source, document]), []);
});

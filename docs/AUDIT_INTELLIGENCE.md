# Cross-page intelligence (audit engine 1.1)

The deterministic audit now checks evidence from pages actually crawled in the same run:

- internal links that lead to fetched noindex pages or fetched redirects;
- canonicals whose fetched destinations failed;
- insecure HTTP image references on HTTPS pages;
- conflicting destinations for the same hreflang language code.

Each new rule records an affected source page and bounded, sorted target evidence; findings feed the existing health score, opportunity engine, persisted audit result, history, and exports. A bounded crawl cannot determine whether an unfetched URL is broken, so these rules do not report unknown targets. These checks are not a substitute for JavaScript rendering, Lighthouse, axe, schema validation, or comprehensive site coverage.

Local check: `node --experimental-strip-types --test web/test/intelligence.test.mjs`. Full web lint/test/build and authenticated preview acceptance are separate gates and must not be reported as passed without their results.

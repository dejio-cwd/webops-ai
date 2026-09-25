import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Native / large / dynamic-require modules must be kept out of the Next bundle
  // and loaded from node_modules at runtime. `playwright-core` does a runtime
  // require('./browsers.json') that the static tracer cannot see, so bundling
  // it produces "Cannot find module .../playwright-core/browsers.json" at
  // request time. `@sparticuz/chromium` fetches a native chromium tarball and
  // `sharp` links a native libvips binary — both crash if bundled.
  serverExternalPackages: [
    "@sparticuz/chromium",
    "sharp",
    "playwright-core",
    "@axe-core/playwright",
  ],
  // Ensure the full package trees ship inside the traced serverless function.
  // The `/*` key applies to every route; the second glob covers a pnpm-style
  // layout in case a future workspace refactor adds one.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/playwright-core/**/*",
      "./node_modules/@axe-core/playwright/**/*",
      "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*",
    ],
  },
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default withWorkflow(nextConfig);

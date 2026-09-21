# WebOps AI

Evidence-driven website intelligence: **crawl → explain → prioritize → fix → verify**.
A serverless-native alternative to Screaming Frog / DebugBear that runs entirely on
Vercel's free tier — no Docker, no local Chrome, nothing to install on your machine.

## What it does today

- **Real multi-page crawler** — breadth-first, same-site, respects `robots.txt`, seeds
  from the XML sitemap, normalizes/de-duplicates URLs, and is hardened against SSRF
  (every request and redirect is validated against private/loopback/metadata ranges).
- **Evidence capture** for every page: status, redirects, headers, title, meta, canonical,
  robots directives, headings, Open Graph/Twitter, hreflang, JSON-LD, word count, links, images.
- **40+ deterministic rules** across Indexability, SEO, Content, Links, Images,
  Structured Data, Accessibility, and Security. Every finding is reproducible and explained.
- **Opportunity engine** — rolls findings up by rule and scores them `severity × scope × ease`
  so you fix the one component, not 2,000 identical errors.
- **Health scoring** by category with an overall grade.
- **Real Core Web Vitals** via Google PageSpeed Insights (Lighthouse in Google's cloud) —
  lab metrics + real-user CrUX field data. No local browser needed.
- **Evidence-grounded AI copilot** (bring your own key) — Explain, Fix playbook, and
  executive summary. The model is instructed to use only captured evidence.

## Architecture

```
Next.js (App Router) on Vercel
├── app/                     dashboard UI (client)
└── app/api/
    ├── audit/route.ts       POST → full crawl + rules + opportunities (maxDuration 60s)
    ├── performance/route.ts POST → PageSpeed / Core Web Vitals
    ├── models/route.ts      GET  → provider catalogue + live free models
    └── ai/route.ts          POST → evidence-grounded explanation / fix
└── lib/                     the engine (crawler, extractor, rules, scoring, providers)
```

The per-request crawl is bounded and deadline-aware so it always finishes inside the
serverless time limit. Crawling thousands of URLs is the roadmap's queue + worker phase.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build + type-check
```

## Deploy (Vercel)

1. Import this repo in Vercel and set **Root Directory = `web`**.
2. (Optional) add keys in **Settings → Environment Variables** — see `.env.example`.
   Everything runs without keys; keys unlock higher PageSpeed quota and the AI copilot.
3. Deploy. Pushes to `main` redeploy automatically.

## Environment variables

See [`.env.example`](./.env.example). None are required to run.

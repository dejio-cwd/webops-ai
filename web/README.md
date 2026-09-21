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
- **No fixed page cap** — crawl limits (max pages, depth, concurrency) are user-configurable
  in Settings → Crawl defaults, up to a 2000-page safety ceiling. A crawl always stops
  cleanly at the serverless deadline and reports `truncated: true` instead of failing.
- **AI Studio with full BYOK** — connect any provider (OpenRouter, OpenAI, Anthropic,
  Google, Groq), a custom OpenAI-compatible endpoint (Azure, Bedrock gateway, vLLM,
  LiteLLM...), or a local Ollama/LM Studio server. Live model discovery, one-click
  connection testing, and per-task routing (explain/fix/summary/chat), all stored only
  in your browser — never on the server.
- **Mule** — a free-form chat assistant wired to whichever connection you configure,
  optionally grounded in the current audit's evidence.
- **Evidence-grounded AI copilot** — Explain, Fix playbook, and executive summary. The
  model is instructed to use only captured evidence.

## Architecture

```
Next.js (App Router) on Vercel
├── app/                     dashboard UI (client) + Settings modal (BYOK, crawl defaults)
└── app/api/
    ├── audit/route.ts       POST → full crawl + rules + opportunities (maxDuration 60s)
    ├── performance/route.ts POST → PageSpeed / Core Web Vitals
    ├── models/route.ts      GET  → provider catalogue + live free models (env-configured)
    └── ai/
        ├── route.ts         POST → evidence-grounded explanation / fix / summary
        ├── chat/route.ts    POST → Mule: open-ended chat, any configured connection
        ├── models/route.ts  POST → live model listing for a specific BYOK credential
        └── test/route.ts    POST → validate a BYOK credential actually works
└── lib/
    ├── crawler.ts, extract.ts, rules.ts, opportunities.ts, score.ts   the audit engine
    ├── ai.ts                server-side provider abstraction (BYOK + env fallback)
    └── connections.ts       client-side BYOK connection store (localStorage)
```

The per-request crawl is bounded and deadline-aware so it always finishes inside the
serverless time limit, regardless of how high `maxPages` is set. Crawling thousands of
URLs reliably in one pass is the roadmap's queue + worker phase.

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

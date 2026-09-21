# WebOps AI Premium Platform Scaffold

A standalone, evidence-first website intelligence platform scaffold. It combines the product surfaces of a professional crawler, technical SEO suite, performance monitor, Lighthouse workbench, accessibility scanner, AI SEO copilot, AI asset manager, Fix Center, and AI Studio. It is independent of Notion and ready to deploy from GitHub to Vercel.

## Included

- Premium responsive command center with Crawler, SEO, Performance, Assets, Links, Accessibility, Structured Data, Security, Opportunities, Fix Center, AI Studio, Analytics, Automation, Integrations, and Settings
- Evidence → deterministic rule → opportunity → AI explanation → approved fix → re-crawl workflow
- Resolution playbooks, provider-neutral AI configuration, specialized agents, model routing, dynamic free-model discovery endpoint, and BYOK-ready data model
- Interactive audit and export demonstrations
- Vercel serverless `POST /api/audit` endpoint
- Initial SSRF protections, DNS/IP validation, redirect blocking, timeout, and response-size limit
- Deterministic title/meta/H1 rules
- Optional Supabase schema with row-level security
- Zero runtime npm dependencies

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Test

```bash
npm run check
```

## Deploy to GitHub and Vercel

1. Create an empty GitHub repository.
2. In this project folder run:

```bash
git init
git add .
git commit -m "Initial WebOps AI MVP"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPO.git
git push -u origin main
```

3. In Vercel choose **Add New → Project**, import the GitHub repository, and click **Deploy**.
4. No build command, framework preset, or database is required for the demo.

## Optional Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Add the values from `.env.example` to Vercel project environment variables.
4. Add `@supabase/supabase-js` when you are ready to replace demo data with persistence.

Supabase is recommended over Firebase for this product because audits, pages, findings, assets, and comparisons are relational and benefit from PostgreSQL queries and constraints.

## Production boundaries

This package is a deployable MVP, not the full distributed crawler. The serverless endpoint audits one page and intentionally blocks redirects to avoid DNS-rebinding/redirect SSRF in the starter. For large crawls, connect the UI to a Docker worker and durable queue as described in the blueprint.

Before public production use, add authentication, rate limits, verified-domain ownership, per-redirect DNS validation, durable jobs, object storage, and a full browser-worker sandbox.

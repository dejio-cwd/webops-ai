# WebOps AI

Evidence-driven website intelligence — crawl, audit, and fix websites with a
deterministic rules engine, real Core Web Vitals, and an evidence-grounded AI copilot.

**The application lives in [`web/`](./web).** It is a Next.js app that deploys to
Vercel with no infrastructure to manage.

## Deploy

Import this repository in Vercel and set **Root Directory = `web`**. That's it —
pushes to `main` redeploy automatically. See [`web/README.md`](./web/README.md) for
details, environment variables, and the product roadmap.

## Repository layout

```
web/            → the WebOps AI application (Next.js, deploy this)
supabase/       → optional database schema for the future persistence phase
docs/           → product scope and implementation roadmap
```

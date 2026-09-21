# WebOps AI — Premium/God Mode Scope

## Positioning

WebOps AI combines the useful capabilities of a professional crawler, technical SEO auditor, performance monitor, Lighthouse workbench, accessibility scanner, AI SEO copilot, and AI asset manager. Its defining principle is evidence-first operation:

1. The crawler collects facts.
2. Deterministic rules identify problems.
3. The opportunity engine calculates importance.
4. AI explains, recommends, generates proposals, and helps verify fixes.

AI never invents raw measurements and never changes production without explicit policy and approval.

## Product modules

1. Crawler — Spider, sitemap, list, URL+sitemap, JavaScript, and hybrid modes.
2. SEO Audit — Titles, metadata, headings, canonical, robots, hreflang, indexability, content, and schema.
3. Performance — Lighthouse, CWV, CrUX/RUM-ready history, waterfalls, budgets, alerts, and comparisons.
4. Asset Intelligence — Image and asset inventory, dimensions, formats, compression, responsive delivery, LCP, CLS, and alt text.
5. Link Intelligence — Status codes, redirects, chains, loops, inlinks, outlinks, external links, and orphans.
6. Accessibility — axe-core machine findings with AI explanation and platform-specific remediation.
7. Structured Data — JSON-LD extraction, normalization, validation, conflicts, and ecommerce entities.
8. Security — Crawler safeguards plus observable TLS, headers, cookie, mixed-content, and exposure checks.
9. Opportunity Engine and Fix Center — Finding aggregation, deterministic scoring, complete resolution playbooks, approvals, delivery, and verification.
10. AI Studio — Chat, models, providers, BYOK, custom endpoints, agents, workflows, prompts, tools, knowledge, evaluations, usage, and cost.
11. Analytics — Immutable history, trends, before/after comparisons, regressions, and business impact.
12. Automation — Scheduled audits, budgets, thresholds, alerts, reports, and continuous monitoring.
13. Integrations — GSC, GA4, Jira, GitHub, Slack, Teams, Magento, object storage, and webhooks.
14. Ecommerce Intelligence — Product/category audits, offers, reviews, availability, variants, faceting, pagination, orphan products, and platform-specific recommendations.

## Finding contract

Every issue must include:

- rule ID, category, severity, and status
- source URL/page/asset
- exact evidence and measurement source
- why it matters
- affected scope
- business impact when data exists
- recommendation
- step-by-step remediation
- platform-specific implementation guidance
- code/config examples where applicable
- estimated effort and confidence
- owner, due date, and delivery target
- Jira/GitHub/report actions
- verification procedure and before/after result

## AI Studio

### Providers

Support provider adapters for OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek, Together, Fireworks, Azure OpenAI, AWS Bedrock, Vertex AI, xAI, Ollama, LM Studio, and custom OpenAI-compatible endpoints.

Free models are synchronized dynamically from provider catalogs instead of hard-coded permanently. Administrators can filter, enable, disable, rank, and cap models.

### BYOK

Keys are encrypted server-side, never stored in browser storage, never returned after creation, never logged, and never inserted into prompts. Credentials support organization/user scope, rotation, revocation, limits, purpose, provider, model allowlists, and usage reporting.

### Router

Routing inputs include capability, vision/tools/structured-output support, privacy, residency, quality, latency, context, cost, availability, evaluation score, and fallback chain. Policies include free-only, cheapest-qualified, fastest-qualified, private-only, premium, and explicit model pinning.

### Agents

SEO, Performance, Image, Accessibility, Content, Schema, Link, Security, Magento, Shopify, WordPress, Developer, Executive, and Fix Verification agents. Each has constrained tools, schemas, approval gates, and an auditable prompt/model version.

## Architecture

- Vercel: Next.js web application, authentication UI, API/control plane, AI interface, webhooks, schedules, and lightweight jobs.
- Supabase/PostgreSQL: tenant data, projects, immutable audits, evidence, findings, opportunities, AI registry/tasks, integrations, monitoring, and audit logs.
- S3-compatible object store: HTML, screenshots, images, Lighthouse JSON, HAR/waterfalls, and exports.
- Durable queue abstraction: Vercel Queues, Redis/BullMQ, Inngest, Trigger.dev, SQS, or Cloud Tasks.
- Docker workers: HTTP crawler, Playwright renderer, Lighthouse, axe-core, asset processing, and AI jobs.

## Production acceptance

The platform is not complete until it can securely crawl verified domains, resume jobs, preserve immutable evidence, reproduce rule results, generate complete remediation, enforce approvals, compare before/after audits, track AI provenance/cost, isolate tenants, rotate credentials, and verify fixes through a new crawl.

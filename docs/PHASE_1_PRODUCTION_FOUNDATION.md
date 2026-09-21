# Phase 1 — Secure production foundation (Weeks 1–4)

This branch starts M0–M2 without pretending that infrastructure configuration is complete merely because files exist in Git.

## Implemented in this change

- Client-controlled AI endpoint validation and hosted local-provider blocking.
- Reusable API origin, rate-limit, and optional Supabase authentication guard.
- Security middleware with CSP and browser isolation headers.
- Health endpoint exposing deployment/auth readiness without secrets.
- Organization, membership, role, domain verification, audit event, and encrypted-credential schema migration.
- CI build/lint and secret-scanning workflow.
- Environment contract for enforcement, Supabase, endpoint allowlists, and credential encryption.

## Required deployment configuration

1. Create or connect a Supabase project.
2. Apply migrations in `supabase/migrations`.
3. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel.
4. Configure server-only credential encryption through a managed KMS; never place raw keys in public variables.
5. Complete the sign-in/session client before setting `SECURITY_ENFORCE_AUTH=true`.
6. Set `AI_CUSTOM_ENDPOINT_ALLOWLIST` when custom endpoints should be restricted to approved hosts.

## Remaining M0–M2 implementation

- Sign-in, sign-up, recovery, invitation, and session-refresh UI.
- Organization/project onboarding and verified-domain workflow.
- Server-side credential vault implementation backed by KMS.
- Replace browser-local AI secret storage and migrate existing settings safely.
- Distributed rate limiting and quotas; the initial limiter is per runtime instance.
- Full premium application shell, command palette, project switcher, saved views, design tokens, and responsive states.
- RLS integration tests, API contract tests, E2E tests, accessibility tests, and preview smoke tests.
- Observability, structured security events, dashboards, and alerting.

## Activation gate

Do not enable mandatory authentication until the session UI is deployed and tested. Do not claim encrypted BYOK until KMS-backed secret creation and retrieval are live. Do not merge without a passing CI build and a review of the CSP against every required production provider.

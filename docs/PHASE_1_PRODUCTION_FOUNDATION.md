# Phase 1 — Secure production foundation (Weeks 1–4)

This branch establishes the secure M0–M2 foundation without treating source files as proof that external infrastructure is configured.

## Current implementation

### Authentication and tenancy

- Supabase email/password authentication with confirmation, recovery, reset, refresh, logout, and HttpOnly session cookies.
- Authentication-aware middleware and protected workspace, onboarding, audit, and AI routes.
- Organizations, memberships, roles, projects, environments, domain verification, audit-event, and pending-invitation schema.
- Owner/admin authorization for membership and provider-credential management.
- Final-owner and cross-tenant behavior requires staging acceptance testing.

### Security and reliability

- Same-origin checks, request-size limits, hashed client identifiers, distributed Supabase rate-limit RPC, bounded cleanup, and local resilience fallback.
- SSRF protection for private IPv4, IPv6, mapped IPv6, localhost, credentialed URLs, unsafe schemes, DNS resolution, and redirects.
- Hosted Ollama/LM Studio blocking and custom-endpoint HTTPS/allowlist validation.
- CSP, browser isolation, privacy headers, request IDs, and no-store handling for sensitive responses.
- Executable contract tests for encryption/tamper detection, request limits, origin enforcement, and SSRF protections.

### Governed AI credential vault

- AES-256-GCM server-side encryption using `CREDENTIAL_ENCRYPTION_KEY`.
- Masked credential listing and create, test, rotate, and revoke operations.
- Owner/admin authorization and audit events for credential mutations.
- Server-side credential resolution using `credentialId`.
- Model allowlist and scope enforcement for generation, chat, model discovery, and testing.
- Provider keys are not returned after creation, stored in browser persistence, or placed in provider URLs.
- Provider error bodies are not returned to clients.

### Product shell and routes

- `/workspace` is the governed Command Center and tenant-management shell.
- `/audit` is the explicit evidence audit workbench.
- `/ai-studio` is the governed provider credential workspace.
- `/accept-invitation` accepts a matching, unexpired workspace invitation after authentication.
- `/` redirects to `/workspace` so users do not unexpectedly land in the legacy audit shell.
- Workspace module actions route to real audit, project, security, team, or AI workflows and do not fabricate metrics.
- Loading, empty, error, protected-route, responsive, and evidence-first states are present in the current shell.

## Required external configuration

1. Apply all migration files in `supabase/migrations` to the intended Supabase project, including `20260922_phase1_invitations.sql` before testing invitations.
2. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel.
3. Configure `SUPABASE_SERVICE_ROLE_KEY` server-side only.
4. Configure `CREDENTIAL_ENCRYPTION_KEY` server-side only; use a high-entropy value of at least 32 characters and never commit or disclose it.
5. Keep `SECURITY_ENFORCE_AUTH=true` in preview/production after confirmed-account testing.
6. Set `AI_CUSTOM_ENDPOINT_ALLOWLIST` when custom AI endpoints must be restricted to approved hosts.
7. Configure auth redirect URLs and mail delivery in Supabase.
8. Add provider credentials through `/ai-studio`; never place provider keys in source, URLs, browser storage, or chat.

## Validation status

### Validated

- Current protected-branch Vercel deployment is Ready.
- `/api/health` reports `status: ok`, authentication enforcement, and safe configuration readiness flags.
- Anonymous `/`, `/audit`, `/workspace`, and `/ai-studio` requests redirect to sign-in.
- Sign-in axe audit reports zero violations; manual contrast review remains required.
- CI includes lint, executable security tests, production build, and secret-scanning workflow configuration.

### Implemented but staging-unvalidated

- Authenticated signup and recovery lifecycle.
- RLS and cross-tenant isolation.
- Invitation lifecycle for users without accounts; the invitations migration must be applied in staging.
- Project archive/delete and environment governance.
- Credential lifecycle against a real provider.
- Distributed rate limits against the connected Supabase database.
- Full responsive, keyboard, authenticated E2E, and manual contrast certification.

### Blocked or external

- GitHub check-run details are unavailable to the connected token because the API returns 403.
- GitHub secret scanning is unavailable because repository Advanced Security/Secret Protection is not enabled.
- Staging acceptance requires a disposable confirmed user, mail delivery, a safe provider credential, and the migration/key configuration above.

## CI and local validation

From `web/`:

```bash
npm ci
npm run lint
npm test
SECURITY_ENFORCE_AUTH=false npm run build
```

The current branch remains a draft PR until the staging acceptance gates pass. Do not merge or promote production without explicit approval.

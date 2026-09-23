# WebOps AI staging acceptance procedure

Run this procedure against the protected Vercel preview after all listed Supabase migrations are applied.

## 1. Configuration

- Confirm `SECURITY_ENFORCE_AUTH=true` in the target environment.
- Confirm Supabase URL, anon key, service-role key and `CREDENTIAL_ENCRYPTION_KEY` are configured.
- Confirm `CRON_SECRET` is configured and never paste its value into tickets, chat or source.
- Confirm the daily Vercel cron is visible for `/api/monitoring/run`.

## 2. Anonymous boundary

- Open `/workspace`, `/api/projects`, `/api/audit`, `/api/fixes` and `/api/monitoring` without a session.
- Confirm protected pages redirect to sign-in and protected APIs return `401`.
- Confirm `/api/health` returns readiness indicators only and no secrets.

## 3. Account and tenancy

- Create or use a confirmed account and sign in.
- Create an organization and project.
- Switch between organizations and projects.
- Set production, staging and development environments.
- Confirm viewer/analyst cannot mutate projects, credentials, Fix Center records or monitoring.
- Confirm owner/admin/developer mutation permissions.
- Confirm a final owner cannot be removed or downgraded.
- Invite an existing account and a new email, then test expiration, revocation and acceptance.

## 4. Domain and audit evidence

- Start DNS, file and meta verification as applicable.
- Confirm private targets and redirects are rejected.
- Run a baseline audit against a safe public site.
- Confirm crawl evidence, findings, opportunities and health score are populated from real results.
- Restore the audit from history.
- Compare two audits and confirm new, resolved, persistent and regression findings.
- Export JSON evidence and CSV findings.

## 5. Credential vault and AI

- Create a provider credential using a safe test key.
- Confirm only masked metadata is returned after creation.
- Test before save, test after save, rotate and revoke.
- Confirm model allowlists and scopes are enforced.
- Confirm AI explanations and Fix Center playbooks reference audit evidence.
- Confirm no key appears in browser storage, URLs, logs, errors or audit metadata.

## 6. Fix Center

- Open a deterministic opportunity in Fix Center.
- Generate an evidence-grounded playbook.
- Move draft → ready → verified.
- Confirm verification note and rollback plan are stored.
- Test bulk transitions.
- Confirm fix audit events are created.

## 7. Monitoring

- Apply monitoring, audit-run, fix-record, fix-verification and monitoring-alert migrations.
- Configure daily monitoring for a project.
- Wait for or manually invoke the scheduler using the secret-bearing scheduler only.
- Confirm a scheduled audit is persisted.
- Confirm regression and failure alerts are created.
- Acknowledge and resolve an alert.
- Confirm alert status is owner-isolated.

## 8. UX and accessibility

- Test keyboard-only navigation.
- Confirm visible focus states.
- Test light/dark theme, mobile width and reduced-motion preferences.
- Confirm loading, empty, error, permission-denied and partial-data states.
- Confirm no fabricated metrics appear when evidence is unavailable.

## 9. Release gate

- Run CI: install, lint, tests, build and Gitleaks.
- Review lint diagnostics artifact if the web job fails.
- Confirm Vercel preview is Ready.
- Confirm production has not changed.
- Keep PR draft until all failed gates are resolved.
- Obtain explicit approval before merge or production promotion.

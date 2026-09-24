# WebOps AI release readiness

## Current scope

- Branch: `phase-1-production-foundation`
- Pull request: draft PR #1
- Production promotion: not approved
- Preview deployment: Vercel Ready
- Cron plan: daily at `03:00 UTC` for Hobby compatibility

## Implementation ledger

| Part | Complete | Total | Remaining |
| --- | ---: | ---: | ---: |
| Part 1 — Production foundation | 7 | 8 | 1 |
| Part 2 — Audit/intelligence foundation | 1 | 2 | 1 |
| Part 3 — Fix Center/AI Studio foundation | 2 | 2 | 0 |
| Part 4 — Monitoring/reporting foundation | 2 | 2 | 0 |
| Part 5 — Enterprise launch | 0 | 1 | 1 |
| **Total code-complete foundation workstreams** | **12** | **15** | **3** |

## Staging acceptance ledger

| Area | Evidenced | Total | Outstanding |
| --- | ---: | ---: | ---: |
| Authentication | 0 | 7 | 7 |
| Tenancy | 0 | 6 | 6 |
| Secrets | 0 | 6 | 6 |
| Security/reliability | 2 | 7 | 5 |
| UX/accessibility | 0 | 6 | 6 |
| Delivery/release | 1 | 7 | 6 |
| **Evidence-backed acceptance total** | **3** | **39** | **36** |

## Required before merge

1. Apply and verify pending Supabase migrations.
2. Confirm GitHub Actions web lint/test/build results.
3. Confirm Gitleaks result without disabling scanning.
4. Run authenticated tenant, invitation and credential-vault acceptance.
5. Trigger one scheduled monitoring run with `CRON_SECRET`.
6. Verify audit persistence, regression alerts and acknowledge/resolve controls.
7. Complete keyboard, focus, contrast and responsive review.
8. Obtain explicit approval before merging or promoting production.

## Security boundaries

- No provider secret is returned to the browser after vault creation.
- No raw cron secret, encryption key or API key belongs in source, logs or audit metadata.
- Production remains unchanged until explicit approval.

> Counting policy: implementation counts increase only after a committed code change. Acceptance counts increase only after reproducible deployed evidence or user-provided evidence. The current three evidenced gates are: safe health/readiness response, anonymous protected API boundary, and successful preview delivery. Authenticated acceptance remains outstanding.

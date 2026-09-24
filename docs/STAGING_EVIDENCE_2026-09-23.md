# Staging evidence — 2026-09-23

Scope: draft PR #1, branch `phase-1-production-foundation`, protected Vercel preview. This document records observed acceptance results, not a production sign-off.

## Directly observed passes

- Authenticated staging sign-in reached `/workspace`; a page reload retained the session. Token rotation, logout and re-login remain separate untested gates.
- `/api/health` returned HTTP 200 with `status: ok`, auth enforced, and all required tables ready on preview version `9d17fb26`.
- Cookie-omitted requests to projects, audit, fixes, monitoring and alerts APIs each returned HTTP 401.
- A labeled QA project using public `example.com` was created under the existing organization. The repaired `/api/projects` endpoint returned HTTP 200 and four visible projects; switching projects and changing the QA project's environment to staging worked.
- An authenticated 10-page-cap audit of the public QA target crawled one page, stored 10 deterministic findings and a health score of 82. The record restored after reload; a second run compared as 10 persistent, 0 new and 0 resolved findings. JSON and CSV export actions generated nonempty payloads with the expected MIME types and headers.
- A loopback target (`127.0.0.1`) was rejected with “Private network targets are blocked.”
- One QA Fix Center record advanced from draft to ready and was still ready after reload. Attempting to verify it against a later unchanged audit returned “The finding still appears on an affected URL”; it remained ready. This is a negative verification test, not a positive verified-fix acceptance.
- A QA monitoring configuration was saved as daily **disabled**, reloaded as disabled, and displayed “Monitoring paused.” No recurring crawl was intentionally enabled for a domain the test user does not control.
- Automated axe audits on the desktop workspace in both themes and on a mobile viewport reported zero violations after the contrast/navigation fixes. The mobile viewport showed navigation and sign-out with no horizontal overflow. Axe still reported one incomplete/manual check; keyboard, focus and manual contrast certification remain open.
- Vercel reported successful preview deployment for commit `9d17fb26a8e5af5e2557c86c078122779ede6a1b`. No production merge/deployment occurred.

## Blocking or unverified gates

- GitHub `get_check_runs` still returns HTTP 403 after session refresh. The available combined status contains only the Vercel deployment; it is **not** CI, lint, full test-suite, build, or Gitleaks evidence.
- The staging vault has no stored provider credential. Provider lifecycle, model allowlists, AI playbooks, masking after save, rotation and revocation need a safe test credential and acceptance procedure; a QA playbook request returned “AI request could not be completed.”
- A second disposable account and controlled invitation email are needed to test invitations, role separation, final-owner safeguards and cross-tenant isolation without risking the current owner account.
- DNS/file/meta domain ownership proof requires a domain controlled by the tester. The QA `example.com` project is deliberately unverified.
- A real scheduler execution and alert acknowledge/resolve need a configured enabled monitor on an authorized verified target and secret-bearing scheduler execution. A disabled QA schedule is not evidence of these gates.
- Positive verified-fix evidence requires a later completed audit that recrawls every affected URL after a real change and clears the finding. No public-site change was made.
- Full enterprise integrations (analytics, issue trackers, SSO/SCIM, retention/regional controls, DR/load/security certifications) are not implemented or accepted by these tests.

## Source commits in this pass

- `f73491e` — corrected PostgREST OR grammar for project listing.
- `76c0c67` — enforced owned audit/project/opportunity scope and actual follow-up crawl evidence for fix verification; removed optimistic verified status.
- `809178a` — desktop contrast corrections.
- `17385a0` — reload per-project monitoring settings and alerts.
- `9d17fb2` — restored mobile navigation and sign-out.

Do not merge, enable production, or mark any unverified gate complete without its own evidence and explicit approval.

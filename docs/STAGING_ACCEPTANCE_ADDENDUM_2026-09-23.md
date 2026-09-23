# Staging acceptance addendum — 2026-09-23

Scope: draft PR #1 on `phase-1-production-foundation`; authenticated Vercel preview. This supplements the earlier staging evidence ledger. It is not a release sign-off. No production merge or deployment occurred.

## GitHub checks access

After the GitHub token was reauthorized with Checks: Read and Actions: Read, `get_check_runs` still failed: `GET https://api.github.com/repos/dejio-cwd/webops-ai/commits/4f5250402fea50655e3409da86560ecd85ebc446/check-runs?page=1&per_page=30: 403 Resource not accessible by personal access token []`. We stopped changing/retrying permissions as requested. GitHub's combined status only reported Vercel preview deployment; it is not Actions/check-run, lint, security-scan, or full CI evidence. A different authentication method may be required.

## Authenticated role and tenancy observations

- The invited disposable account `ocpdeji@yahoo.com` accepted a viewer invitation to CWD Limited. Before acceptance it could not see that organization's projects, memberships, audit runs, fixes, or monitors; afterwards it saw five shared projects.
- Viewer writes to project creation/update/deletion, monitoring configuration, Fix Center creation, invitation creation/reading, and credential creation/reading were denied (HTTP 403 in the tested requests). This is observed route coverage, not a complete matrix for every endpoint.
- The disposable account created an isolated `Cross-Tenant QA 2026-09-23` organization and one project, remaining sole owner there. Final-owner downgrade/removal attempts returned HTTP 409. A revoked invitation could not be accepted (HTTP 400).
- With the disposable account as owner of tenant B, PATCH/DELETE using tenant B's organization ID and tenant A's project ID initially exposed a bug: the PATCH returned HTTP 200 with a null project and wrote a spurious audit event. Commit `d871368` corrected the match and affected-row checks; the same mismatch requests then returned HTTP 404, leaving the tenant A project intact. The historical spurious QA event remains in the audit log and must not be mistaken for a real mutation.
- Tenant switching caused a client crash due a custom select wrapper changing the DOM hierarchy. Commit `906132e` keeps the selector mounted; preview retest switched to tenant B without that crash and showed only its project.
- A subsequent project-audit access fix, commit `20bd973`, permits current organization members to read audits explicitly scoped to a project, while only owner/admin/developer may start a project-associated audit. Its source tests passed locally (10/10 across the available contract/unit tests). Vercel preview status reported success. In an owner-authenticated staging retest, Nyrius QA project history returned zero rows, the example.com QA project returned one row with the matching `project_id`, and access to tenant B's isolated project returned HTTP 403. Fresh viewer-session runtime retest of this final audit-access change remains open because the secure browser-input operation did not submit the disposable sign-in form.

## Domain, crawl, and audit evidence corrections

- A separate staging QA project for `nyrius.com` was created; the existing Nyrius production project was not changed. A TXT verification challenge was generated for `_webops.nyrius.com`. The token was not found when checked, so domain ownership remains **unverified**. Do not rotate the challenge without coordinating DNS changes.
- Public `https://nyrius.com/robots.txt` disallows `/` for the tested crawler path. A bounded default-robots audit crawled zero pages. The former engine stored a misleading score of 100 on a zero-page, unassociated run; that historical record is invalid as positive crawl evidence.
- Commit `5471f02` changed zero-page audits to HTTP 422 with no fabricated score; UI no longer presents a historical zero-page score as valid. The preview retest of Nyrius returned the zero-page error rather than a positive audit.
- Earlier example.com audits in the prior ledger were persisted under the owner but **not associated with the selected project**. The audit workbench failed to hydrate `projectId` and `environment` from its URL, and history was owner-wide. Commit `5471f02` bound new project audits to selected project/domain/environment and filtered list, restore, and comparison by project. An authenticated one-page example.com run made after this fix had score 82 and appears once in the scoped QA history with the matching `project_id`. Domain- and environment-mismatch requests were rejected with HTTP 400. Do not read the earlier ledger's proximity of the QA project and audit result as evidence of prior project association.
- Scheduled-crawl positive acceptance is **not complete**. There is no verified Nyrius domain and its robots policy prevents the intended default crawl. The example.com daily QA monitor was saved disabled, not executed. The scheduler-secret invocation, alert lifecycle, and positive recrawl/fix verification remain unproven.

## Remaining release gates

- GitHub Actions/check-runs evidence via a working authorization path; full tests, lint/build, secret scan, review, and deploy gates.
- User-controlled DNS TXT propagation and an approved robots policy for Nyrius; then ownership verification, successful crawl, scheduling, observed worker execution, alert state transitions, and positive fix recrawl.
- Fresh viewer-session retest after the latest audit-access change; expanded role/endpoint and cross-tenant matrix.
- Safe test provider credential and positive credential lifecycle, model allowlist, AI playbook, rotation/revocation tests.
- Manual accessibility checks and complete enterprise integration, SSO/SCIM, retention/regional, load/security/DR gates. These are not silently reduced to an MVP.

Explicit owner approval is required before any production merge or deployment.

## Subsequent independent work (still not release acceptance)

The user confirmed they cannot access Nyrius DNS/registrar. TXT ownership proof is therefore an **external blocker**. No DNS challenge was rotated, no robots override was made, and no Nyrius scheduled crawl was counted as a pass.

- Commit `e68445c` hardened the scheduled worker: it requires a verified project before crawling, keeps `respectRobots: true`, atomically claims the due monitor row by its prior `next_run_at` and enabled state, refuses to report completion if audit evidence persistence fails, and updates an existing unresolved regression alert instead of blindly inserting duplicate fingerprints. Four mocked worker tests passed locally. A live successful scheduled run remains unverified: no authorized verified QA target and scheduler-secret execution evidence are available.
- Commit `8f1208d` authorized project-member reads of monitoring configuration and alerts, restricted alert transitions and monitor writes to owner/admin/developer, and writes one canonical owner configuration using the `owner_id,project_id` upsert conflict target. Three mocked role/tenant tests passed. These changes have not yet had a viewer-authenticated staging runtime retest.
- After these commits the available local test set reported 17 passing tests; Vercel's combined status reported a successful preview deployment for `8f1208d`. These are not substitutes for inaccessible GitHub Actions/check-run results or complete end-to-end acceptance. Cookie-omitted staging requests to scheduled run, monitoring configuration, and alerts each returned HTTP 401.

The shared browser is at staging sign-in pending the user's chosen Take Control viewer login. Do not describe the viewer runtime gate as passed until the session is authenticated and those routes are exercised.

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

Further preview-only changes: `b022d5c` records a project-scoped failure alert and an explicitly reported retry outcome after a claimed scheduled run fails; it does not claim that any live scheduler execution occurred. `683aa99` rejects attempts to **enable** a monitor for an unverified project with HTTP 409, while retaining the ability to save a disabled QA configuration. Nineteen available local tests passed, including mocked failure-alert and unverified-domain cases; Vercel's status reported successful deployment for `683aa99`. GitHub Actions/check-run visibility and live scheduler acceptance remain blocked or unverified respectively.


## Viewer Take Control and vault follow-up

The user completed the disposable viewer sign-in through Take Control. This **supersedes the earlier pending viewer-session note** above; it does not retroactively prove unrelated routes.

- Authenticated viewer GET of the CWD example.com QA project's audit history returned HTTP 200 with one row whose `project_id` matched the selected project. Nyrius staging QA history returned HTTP 200 with zero rows. The isolated tenant B project returned HTTP 200 with zero rows to its owner. CWD example.com QA monitor GET returned HTTP 200 with one matching project configuration; alerts GET returned HTTP 200 with zero rows. This verifies readable team evidence and scoping, not alert transition behavior.
- A viewer attempt to start a project-associated audit returned HTTP 403 before crawling, and a viewer monitor write returned HTTP 403. Acting as tenant B owner, PATCH and DELETE for tenant A's project while supplying B's organization ID each returned HTTP 404. A follow-up project list showed both QA projects in their original organizations and staging environments. UI switching to tenant B showed its sole project without the prior selector crash.
- On tenant B's isolated unverified QA project, two **disabled** monitor saves (daily then weekly) returned HTTP 200 with the same record ID; GET returned one weekly disabled configuration. Attempting to enable it returned HTTP 409 and it remained disabled. No scheduler execution was implied or triggered.
- Commit `4eb9799` changed credential create/rotate/revoke responses to require an affected row before reporting success; four mocked vault tests passed. In a live isolated-tenant attempt with a synthetic, non-provider key, credential creation returned HTTP 500: `Credential encryption key must contain at least 32 characters.` No credential ID was returned or stored, so rotation, revocation, masking-after-save, and positive provider use **were not accepted**. The staging encryption-key configuration must be repaired by an authorized environment owner using a strong secret; it must not be supplied in chat or committed to the repository.
- Commit `31e993a` added a non-secret vault readiness indicator. Authenticated preview GET `/api/health` returned HTTP 200, `status: degraded`, `credentialVaultReady: false`, `authenticationReady: true`, and `requiredTablesReady: true` on version `31e993a3`. This accurately records the configuration blocker; it is not an enterprise-ready health pass.

GitHub check-runs 403, Nyrius DNS ownership, robots-constrained crawl, live scheduler/alert lifecycle, positive provider/AI tests, and broader enterprise integrations and certifications remain open. No merge or production deployment occurred.


## Corrected Preview vault and isolated QA acceptance

This section **supersedes the earlier vault-readiness blocker** above. After the user corrected the Preview branch environment scope and redeployed, a no-cache health response for `c62fd775` reported `target: preview`, `branch: phase-1-production-foundation`, `credentialVaultKeyState: meets_minimum`, `credentialVaultReady: true`, `requiredTablesReady: true`, `authEnforced: true`, and `status: ok`. This validates the vault key's minimum-length check and configuration presence, not the key's entropy or any production environment.

- In disposable tenant B, a synthetically generated **non-provider** credential was created (HTTP 201), listed (HTTP 200) without raw or encrypted secret fields, rotated (HTTP 200, `rotated_at` present), and revoked (HTTP 200, `revoked_at` present; status `revoked`). The listed model allowlist and `staging` scope persisted. A viewer-role rotation attempt against tenant A returned HTTP 403; a viewer-role GET of A's credential list returned HTTP 403. A later AI request referencing the revoked synthetic credential returned HTTP 502 with no generated text. This is vault lifecycle and negative-use evidence, **not** a positive provider connection or successful AI generation. The synthetic QA record was left revoked.
- In tenant B's isolated staging project, one bounded, robots-respecting example.com audit crawled one page, scored 82, and appeared once in its project-scoped history. Cross-project detail lookups in either direction returned HTTP 404, and a cross-project comparison returned HTTP 404. A second bounded one-page follow-up returned score 82; comparison found 10 persistent, zero new, zero resolved findings. These tests do not establish ownership of example.com or authorize it as a scheduled target.
- A disposable Fix Center draft for `SEO-META-MISSING` persisted. Initial draft-to-ready transition returned HTTP 502 and left the record in draft. Commit `02b191c` supplied the unique `(owner_id,audit_id,opportunity_id)` upsert conflict target. On deployed Preview `02b191c1`, the same record transitioned to ready (HTTP 200, same ID, persisted). Self-verification against the baseline returned HTTP 409, and verification against the later unchanged audit also returned HTTP 409 (`The finding still appears on an affected URL`); the record remained ready. **Positive verified-fix acceptance remains open** because no site change cleared the finding.
- The scheduler endpoint returned HTTP 401 to an ordinary authenticated session. A mobile-width sample at 390px showed navigation and sign-out, with no horizontal overflow; one sampled app keyboard focus had a visible outline. This is not complete manual accessibility certification.

Still open: GitHub check-runs/CI evidence (prior 403; no permission retries), real-provider connection and AI output, model/usage/cost acceptance, verified controlled domain and robots-allowed positive Nyrius crawl, live scheduler/alert lifecycle, positive fix verification, complete role matrix, accessibility manual checks, and the remaining enterprise integration, SSO/SCIM, retention, load, security, and DR gates. No production merge or deployment occurred.


## Fix Center collaboration and upsert regression — Preview only

- On the deployed Preview at commit `02b191c1`, the isolated tenant-B disposable Fix Center record for `SEO-META-MISSING` was transitioned `draft` → `ready` again. Both writes returned HTTP 200; the same record ID persisted and a scoped GET returned `ready`. This confirms the `(owner_id, audit_id, opportunity_id)` conflict target resolves the previously observed draft-to-ready HTTP 502. It does not prove a verified remediation.
- Commit `7dcab1d` makes project-scoped Fix Center reads available to an authorized project member while retaining owner/admin/developer-only writes. Nineteen available local contract/regression tests passed. The Preview health response was HTTP 200 with `status: ok`, Preview target, branch `phase-1-production-foundation`, authentication enforced, vault ready, and required tables ready.
- Runtime acceptance: acting as the CWD writer, a disposable CWD QA draft record was created for the completed project audit. Acting as the invited CWD viewer, the scoped GET returned HTTP 200 and included that same record/project; a POST attempting to advance it returned HTTP 403 with the expected writer-role error. This verifies the tested shared-read / writer-only-write path, not every role or endpoint.

The positive verified-fix, real-provider AI, controlled-domain/robots, scheduler/alert lifecycle, CI/check-run visibility, full accessibility, SSO/SCIM, retention/regional, load, security, and DR gates remain open. No production merge or deployment occurred.

## Independently executable gate follow-up — Preview only

- The available local contract/regression suite was rerun after the Fix Center work: 19 tests passed, 0 failed. A targeted literal scan of the locally modified Fix Center route, workbench page, regression test, and ledger found no secret-like committed literal. This is **not** a whole-repository or GitHub Advanced Security scan.
- With browser credentials intentionally omitted, Preview returned HTTP 401 for `/api/audit`, `/api/fixes`, `/api/monitoring`, `/api/monitoring/alerts`, and `/api/provider-credentials`. The public Preview response exposed `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, HSTS, and `X-Frame-Options: SAMEORIGIN`.
- The 390px mobile sample had no horizontal overflow. Thirty visible controls in the sample had a computed keyboard-focus indicator; navigation focus reached the Audits module, which also had no horizontal overflow at 390px. These are automated/sampled observations only, not full assistive-technology or WCAG certification.
- Root `vercel.json` currently configures a daily `0 3 * * *` monitoring cron. The current Preview deployment was Ready. The historical Vercel failure for an hourly cron does not apply to that checked-in daily schedule. The worker still requires `CRON_SECRET`, refuses unverified projects, and invokes the crawler with `respectRobots: true`; no live scheduler execution was attempted.
- At this check, PR #1 had zero review threads and zero review comments. An automated review was requested, but no review result had returned at the time of this evidence capture. GitHub check-run visibility remains unavailable under the configured token (previous HTTP 403), so neither CI nor security scanning was inferred from Vercel's deployment status.

External gates remain external: human code review; usable GitHub checks/CI and whole-repository secret scanning; a verified controlled domain with robots permission and a remediated finding; a real provider credential and authorized test spend; a scheduler secret and a production-approved scheduler target; and the policy/infrastructure decisions and environments for SSO/SCIM, retention/regional controls, load, security, DR, and complete accessibility certification. No merge or production deployment occurred.

## Current Preview acceptance continuation — no Production action

### GitHub integration evidence boundary

- The connected GitHub integration successfully read private repository branch metadata, `README.md`, and draft PR #1. Its Checks request against `GET /repos/dejio-cwd/webops-ai/commits/b1ca817af9466ea423161fd7c6ab4fef1d2e4cd1/check-runs?page=1&per_page=30` returned `403 Resource not accessible by personal access token`. This is recorded as an external MCP/GitHub integration limitation. No token was created, replaced, changed, or exposed.
- Actions workflow-run evidence is **unverified**: the connected MCP exposes no authenticated Actions workflow-runs operation or generic authenticated REST operation, and no credential handle is available to the execution environment. No status was inferred from Vercel.

### Credential vault lifecycle — isolated synthetic credential

- With Preview health reporting vault readiness, an isolated tenant-B owner created a newly generated non-provider staging credential (HTTP 201), observed only its hint/metadata on read (HTTP 200; no raw or encrypted secret field), and confirmed model allowlist `gpt-4o-mini` and `staging` scope persistence.
- Rotation succeeded (HTTP 200; `rotated_at` present; active status), while an attempted rotation through the CWD tenant returned HTTP 403. Revocation succeeded (HTTP 200; `revoked_at` present; revoked status). The disposable synthetic credential was left revoked. This is lifecycle/isolation evidence only; real provider connectivity and generated output remain blocked on an authorized provider credential and test budget.

### Monitoring, scheduler, and tenant safety

- Static source review found current scheduler controls for `CRON_SECRET` authorization, verified-domain gating, `respectRobots: true`, atomic due-row claims, failure-alert handling, and retry reporting. Runtime staging check in isolated tenant B saved one disabled weekly monitor (HTTP 200), retained one disabled configuration on read (HTTP 200), rejected enabling the unverified project (HTTP 409), and rejected an ordinary session at `/api/monitoring/run` (HTTP 401). No scheduler secret, external scheduler call, crawl, or robots bypass was used.
- A cross-tenant mutation retest used tenant B's workspace ID with a CWD project ID. PATCH and DELETE each returned HTTP 404; a final project read confirmed the CWD project remained present and `staging`.
- Positive Fix Center remediation/follow-up acceptance is blocked: available QA targets are not a controlled remediable domain, and Nyrius remains unverified with robots restrictions. No crawl policy was bypassed.

### Explicit blockers not counted as passed

- Supabase migration execution and full RLS/constraint inspection require approved database-console or migration-runner access; table-readiness health is not treated as full migration acceptance.
- Real AI/provider, verified controlled domain/remediation, live scheduler execution, Actions workflow evidence, Checks API evidence, and Production acceptance remain unverified. PR #1 remains Draft; no merge or Production deployment occurred.

## Staging database authorization remediation — verified

- Read-only staging schema inspection found that RLS was enabled, but `anon` and `authenticated` retained direct table privileges on `public.projects`. The prior project policy allowed organization members to read projects and could permit a member to create an owner-attributed project directly through PostgREST, bypassing the application API's writer-role guard. This was treated as a concrete release-blocking authorization defect, not as a passed RLS gate.
- Commit `b2fe6f6` adds `20260923_phase1_projects_server_only.sql`, which revokes all direct table privileges on `public.projects` from `anon` and `authenticated`; the server-mediated API continues to use its service role only after authorization. The migration was applied successfully to the verified staging/Preview Supabase project. A read-only `information_schema.role_table_grants` check then returned no rows for those roles on `public.projects`.
- On Preview `b2fe6f6`, the dedicated migration regression test passed and the affected project/audit/Fix Center authorization suite passed 7/7. Authenticated tenant-B runtime retest returned 404 for cross-tenant PATCH and DELETE attempts, and the CWD project remained present with environment `staging`.

No Production database, environment, deployment, or grant/RLS setting was changed. Positive remediation, real provider, live scheduler, GitHub integration evidence, and enterprise certification gates remain separately blocked or unverified as previously recorded.

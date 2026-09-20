# Parent pilot interface integration

Status: integrated and locally verified in the fork; exact-head CI and peer review pending. No production change. Base: fork #9 `74a4a35e6d2633eff35cc6bbf71cf6e6b5a7e482`, on canonical main `4335e8984777b7b704e8706d3fe277352658c9ed`.

## Scope and provenance

Compose existing Imad-owned parent work into the current staff/Auth candidate. Use selected commits with `cherry-pick -x`; preserve original migration bytes. Do not merge whole fork #1/#2 ancestry: it contains superseded coach-code onboarding. Existing #48 Settings and PasswordInput are already present and must be reconciled, not replaced.

1. `484ad20`: complete match summaries and cursor history, invoker RPCs and regression fixtures.
2. `01304a4`: retained development history with nullable/deleted coach attribution.
3. `da5412b`, `a2bda4b`, `d1bc895`: existing pinned history-upgrade verification and suite metadata, preserving the current staff suites and workflow.
4. `6d3bb25`: existing consent retry UI, inspected against current shared Auth boundaries; no new consent authority or household schema.
5. `fdf51aa`: exact selected match, assessment and award details; never substitute a stale cached record when authority or retrieval changes.
6. `f74a8a7`: private-avatar presentation and upload feedback, preserving current verified-account Settings controls.
7. `7216ae0`: accessible password visibility using the already present shared component; retain staff-invitation admission gates.

The committed result and any omitted/dependent hunks will be recorded below. Shared runner changes are composition of the existing parent-history hooks, not a competing replacement for Tarek's #42 registry work.

## Acceptance and verification

- Parent Home totals include all authorized matches beyond API row limits. History cursor navigation reaches every record once in a static fixture and survives retry, child/account changes and empty later pages.
- Opening a match retrieves exactly that child's selected record. Assessments and awards display the selected authorized record; private coach notes/AI drafts are not exposed.
- Deleted/departed author labels cannot erase retained authorized history. Academy ownership and consent remain release gates; this UI does not fix the known departure/export backend failures.
- Profile images resolve from the existing private Storage boundary; upload/reset feedback cannot leak across account changes. No claim about hosted Storage policy follows from mocked UI tests.
- Password toggles work by keyboard and preserve input values without bypassing current staff admission or Auth recovery.
- Run focused source checks first, then complete source/harness/type/lint/build checks, existing/new built-app phone journeys and fresh/deployed-order SQL replay. Verify history role checks in native PostgreSQL with synthetic fixtures and API row-cap behavior where relevant. Exercise combined account-switch/child-switch behavior, not just independent components.
- Preserve explicit coach-only match logging and fully waived academy invitations; no old coach-code enrollment, payments, household schema or unrelated owner routes.

## Rollout and rollback

Publish to the fork for exact-head peer review. The additive history RPC migration must precede its frontend; verify role/consent boundaries and a synthetic parent journey in the target environment only after separate production approval. H0 household contract review, other owners' implementation, real email/Storage verification and coach-departure ownership fixes remain open. Roll back the frontend if necessary; leave unused additive read RPCs until a reviewed cleanup. Never weaken backend authorization as a rollback.

## Evidence

The reused history-upgrade harness initially failed against the larger candidate: its historical 62-migration inventory omitted newly merged privilege/consent and pending staff migrations, and its temporary fixture lacked the migration filename validator. Reused the later helper/tests from fork #1 `a15219b`, then pinned the exact 68-migration dependency candidate `74a4a35`. The history migration remains last after that candidate, preserving the known report-before-parent deployment inversion. This is main plus pending staff followed by history, not a claim those staff migrations are deployed. All six role-suite completion reports are required, with negative controls for missing staff results. Current original main migrations and the original history migration must remain byte-identical.

- Source: **662 tests in 50 files pass**. Initial focused parent/Settings/password checks: 155 pass. The first complete source run found four fixture failures because the migration-input fixture omitted the newly imported helper; copying that real helper restored the existing assertions. The new upgrade-mode duplicate-version check also passes before any SQL runs.
- Harness: **17 pass**. History-upgrade controls: **8 pass**, including actual CLI execution and deliberate missing history, privilege and staff reports. Staff admission regression controls: **14 pass**. Typecheck/build pass; lint **0 errors / 127 inherited warnings**. Actual bundle: 97 files, 83 readable, 79 named chunks; no dev-only modules or burned credential values.
- PGlite: **69 original migrations**, six suites pass in fresh, report-before-parent and candidate-before-history order. Completion counts: P1 55, reports 282, history 81, privilege/consent 151, staff admission 51, delivery 27. All 68 dependency migration files and the original `484ad20` history SQL were compared byte-for-byte; unchanged.
- Native PostgreSQL **17.11**: six suites pass in fresh order, followed by **13 independently connected staff admission/delivery races**. A separate private Unix-socket replay also passes all six suites after the 68-migration candidate, explicitly proving the history RPCs absent before applying history as migration 69. Its first temporary harness attempt correctly refused the missing disposable marker on a new connection; the corrected run set the marker on every connection and removed its cluster. No hosted database connection was used. The row-cap HTTP experiment in the historical history document was not rerun; the unchanged scalar SQL and 81 role/pagination assertions were rerun natively.
- Built Chromium: initial run **52 pass / 2 fail**. Both failures were superseded public coach/club signup expectations from #71; current App routes correctly require invitations. Those obsolete cases were removed, the actual staff activation journey gained keyboard/independent confirmation-toggle assertions and zero-write checks before submission, and **all nine affected invitation/staff journeys pass**. The resulting active suite contains 52 journeys; all have passed locally, but this is not a claim of one final full local run. CI must run the final active suite. It includes 1,001-row history, exact details, retained selection, failed reads, consent recovery, private photo decode/upload/reload for four roles and current Auth/session races. Backend HTTP is intercepted synthetic data. Inspected parent match/assessment/photo screenshots at 390px; existing Auth journeys also cover 320px.
- The shared AuthContext, Auth fetch, App routes, onboarding-session and Settings-account helper files are byte-identical to `74a4a35`. No old coach-code changes were brought over. UI-only avatar changes in other roles are the reused fork #2 slice.
- The use-case reporting gate exits 0 but still reports **three pending UC-A02 failures, 10 passed assertions and 15 pending cases without tests**. Tarek's coach-only retirement and broader pilot acceptance remain separate; these are not described as a green all-role acceptance result.

Commands: `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:db`, `npm run test:db -- --parent-upgrade-review`, `node --test tests/db/parent-history-upgrade.test.mjs`, `npm run test:staff-guards`, `python3 scripts/test-staff-admission-native.py --pg-bin /opt/homebrew/opt/postgresql@17/bin`, and `node node_modules/@playwright/test/cli.js test --config playwright.pilot.config.ts`. Affected browser rerun adds `e2e/parent-invitation.spec.ts e2e/staff-admission.spec.ts`. Local evidence is in `/tmp/trak-parent-interface-*.log`; the supplementary native upgrade reproduction is `/tmp/trak-parent-interface-native-upgrade.py`.

Current Supabase changelog and function/Storage documentation were consulted. This slice reuses stable invoker functions with explicit EXECUTE grants; it creates no table, changes no policy and does not upgrade a dependency. No applicable breaking change required a source change. Existing independent ownership/consent/Storage findings are not waived by these local checks. Earlier branch results are provenance only and are not counted as verification of this composition.

# Staff admission foundation — draft, not a release candidate

Base: canonical main `4335e8984777b7b704e8706d3fe277352658c9ed`. Decision: [academy-led admission](academy-led-admission.md), including fully waived pilot enrolment and no later payments.

## Scope and observed failures

On unchanged main, actual authenticated calls successfully create public coach/admin profiles, insert a coach profile directly, join by a shared academy code and move coach membership directly to another academy. The baseline control requires those five assertion failures; absent new functions or a SQL syntax error cannot satisfy it.

The new forward migration adds an unexposed `trak_admission` schema containing explicit platform-owner authority, invitations and transaction-scoped activation capabilities. It grants authenticated callers only three public RPCs: `issue_staff_invite`, `accept_staff_invite`, `revoke_staff_invite`. Each performs server-side authorization; private helpers/tables are inaccessible to application roles. No owner identity is automatically trusted.

Invitations bind verified recipient email, issuer authority, staff role and academy. They expire in seven days; a deliberate resend revokes the previous pending invitation. Raw random tokens are returned once, never persisted. Repeating an issuance request returns status without another token; a lost initial response requires a new request ID and explicit rotation. Acceptance is atomic and repeated clicks succeed only while the accepted membership still exists. An old accepted link cannot restore a removed coach.

Guards block new staff creation and membership reassignment through existing RPCs/direct writes. Profile and academy identity are pinned. Ordinary Settings upserts and departure/deletion remain supported. AFTER INSERT guards distinguish actual new rows from an existing-row UPSERT; an exception rolls back the complete statement. FK cleanup may clear coach membership when the referenced academy has already been deleted; an application cannot manufacture that state while the FK holds.

## Verification

- `npm run test:db`: all 67 migrations replay; parent invitation, operational view (282 assertions), privilege/consent and staff (51 assertions) suites pass on disposable PGlite PostgreSQL 18.3.
- `npm run test:staff-guards`: eight controls pass: unchanged-main bypass reproduction plus seven runtime mutations (recipient, verification, expiry, revocation, staff-write guard, replay membership and academy authority). Tests require the named behavioral failure, not an arbitrary error.
- `npm run test:staff-native -- --pg-bin /opt/homebrew/opt/postgresql@17/bin`: the same four SQL suites and ten independent-connection races pass on PostgreSQL 17.11. Each race observes the second transaction blocked on the first before committing the first. Cases: duplicate issue, duplicate acceptance, two academies/one recipient, resend/accept, both revoke/accept orders, owner withdrawal, issuer removal, recipient email change, and acceptance preceding owner withdrawal.
- Add `--falsify-recipient-lock` to the native command: deliberately removing the recipient advisory lock lets both competing invitations succeed; the control verifies that failure state. The ordinary suite rejects it. Only disposable databases are permitted.
- Deployed-order replay (`npm run test:db -- --parent-upgrade-review`) also passes all four SQL suites. Five existing intercepted parent browser journeys pass; these do not exercise the unfinished staff activation UI.
- Source tests: 385 pass; harness: 17 pass; typecheck/build pass; lint: zero errors, 134 existing warnings. Use-case gate exits successfully but still reports three pending UC-A02 failures (missing player-log route) and 15 pending use cases without tests. They remain debt.

Regression tests caught two defects in the initial draft: delimiter collisions between invitation scopes, and blocking ordinary coach Settings UPSERTs. They also caught an academy-deletion FK cleanup regression. All three are fixed and have persistent assertions.

CI adds the behavioral controls and a disposable PostgreSQL 17.11 service for concurrency. The service uses synthetic local credentials and never reads the live database URL. All fixtures refuse unmarked/nonempty databases.

## Composition and release limits

The staff suite declares `-- @trak-suite mode=--staff-admission-review in-all=true`; its verdict helper declares `-- @trak-fixture`, compatible with Tarek's #42 registry. When composing with #42, retain its registry runner, discard this branch's hardcoded suite-array addition, and retain the staff assertion-count output. Baseline/mutations run separately and need no extra runner mode. Composed the new migration/suites with the unchanged registry and migrations from #42 at `918d8c3` in a disposable copy: `--all` discovered `staff_admission.sql` and passed all five registered suites, including academy isolation. This does not verify #42’s frontend changes.

This is backend staff admission only. Before release: guarded Auth creation/email delivery, activation/expiry/retry UI, owner bootstrap, generated client types, household waived enrolment, consent-before-child-credentials, child session suspension, academy roster assignment, removal of legacy callers and deliberate existing-identity migration. Existing staff identities are not auto-revoked or converted. Public player/parent provisioning is still present pending household cutover. Minimal account deletion is tested for all roles; deletion with complete development history and composition with pending #44/#47/P2 need their separate integration tests.

No production SQL, live Auth changes, email delivery or frontend cutover has occurred. The migration must not deploy by itself: it intentionally rejects legacy staff signup. Review this draft with Kostas/Tarek, integrate callers and migration strategy, then request production approval. Recovery is a reviewed forward change preserving invitation/admission evidence; do not reopen shared-code or public-role admission as rollback.

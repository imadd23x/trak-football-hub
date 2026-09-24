# TRAK-47 parked-feature boundary implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded SQL implementation and sequential spec/quality reviews. Parent owns UI, integration and release gates.

**Goal:** Make every deferred route truthful and close its dedicated application writes while keeping the smallest credible product journeys and account rights available.

**Architecture:** Reuse the G7 static placeholder and retain role guards. Redirect retired coach entry points to existing P0 pages; enforce dedicated backend boundaries through forward grants/policies and an RPC execution gate. Keep trusted incident operations and shared table capabilities.

**Tech stack:** React 18, TypeScript, Supabase/Postgres, Vitest/MSW, Playwright and disposable PGlite/native PostgreSQL.


Source: proposed G7 #119 at `19cdbc00c70eb39826907f4c61e5156b071f7e90`, containing canonical main `93e7037`. Route decisions are approved #115; the registry prerequisite is approved #116. Neither is merged. This is local preparation, not a release-order change.

## Executed route audit

18 real-App/AuthProvider/SDK routed checks: 10 expected failures and 8 passing controls. Eight pages still mount parked features: coach recognition/award, parent alerts, and club home/squads/coaches/profile/radar. Two legacy routes still mount Add Player and Quick Assess. Passing controls are the five #119 placeholders, the J4 quick-match entry, the J5 manual-assessment entry and club account settings. The test intercepts synthetic HTTP and uses unique actors; no live API request is made.

The first run had a text-selector mismatch in a positive control; the confirmed log uses the actual full empty-state text. The final proposed Add Player redirect follows #116 UC-C02 v2. Quick Assess redirects to the retained manual assessment route.

## Implementation scope

1. Work on a separate `codex/TRAK-47-parked-features` branch with #119 plus the exact #115/#116 dependencies recorded. Do not broaden #119 or J6's tested branch. Announce shared-file/migration scope first; agree reviewer success criteria before opening the PR.
2. Extend App route placeholders to the eight pages above; preserve existing five G7 placeholders. Retire `/coach/squad/add` by redirecting to `/coach/squad`, and `/coach/quick-assess` by redirecting to `/coach/assess`. Keep `/coach/sessions/quick` functioning as match mode.
3. Remove Add Player controls in CoachHomePage and CoachSquadPage and replace their empty-state guidance with academy-managed admission. Retarget the CoachHomePage Quick Assess and PostMatchPrompt links to `/coach/assess`, with truthful labels. Keep roster backend INSERT/DELETE ownership with TRAK-48/TRAK-62.
4. Park every club page while preserving an explicit `/settings` action for account access, password, sign-out and deletion. Avoid a club-home placeholder whose only exit links to itself. Do not blanket-revoke profiles, organizations or shared P0 read tables.
5. Close dedicated parked-feature writes in a new forward migration: calendar events and recognition awards, with application-role INSERT/UPDATE/DELETE and inherited PUBLIC grants addressed. Revoke application-role and inherited PUBLIC execution of `remove_coach_from_org(uuid)` while retaining its trusted incident-operation path; the final 47 SECURITY DEFINER bodies were audited for alternate schedule/recognition writes. Keep J4 sessions/match RPCs, J5 assessments/notes and account export/deletion operational.
6. Add authenticated negative database tests with retained-row controls and permitted P0/operator positive controls. Existing coach-departure/deletion suites must retain their security invariants if app access to a parked RPC is closed. Do not silently weaken their checks to get green.
7. Reconcile Quick Assess route tests and parent Alerts browser expectations with the approved parked contract; retain full-assessment consent checks and sibling isolation on P0 parent Home/Matches/Profile. Leave legacy component tests useful where they are not routed-contract assertions. Execute #116's UC-C02 tests unchanged.
8. Run all repository checks, both disposable database engines for the new migration, and mobile browser controls. Request internal review, then team non-author review. Preserve the post-demo release hold and record deployed proof separately.

## Dependency/ownership boundaries

- #115: reviewed product decisions; #116: registry prerequisite; #119: existing G7 routes/AI/photos.
- TRAK-48: roster/profile admission and coach INSERT denial.
- TRAK-62: coach roster DELETE/cascade choice with #128.
- #132/TRAK-59: `meeting_requests` closure already reviewed, do not duplicate it.
- TRAK-13: immediate open-session withdrawal remains independent.

## Local evidence

- `/private/tmp/trak47-audit-y_vwsso_/src/__tests__/parked-routes-audit.test.tsx`
- `/private/tmp/trak47-ui-audit-confirmed.log`
- Database audit: PGlite and native PostgreSQL 17.11 each replayed all 87 migrations and passed 54 current-state observations/controls, then failed the same 6 intended closure assertions. Calendar own INSERT/UPDATE/DELETE and recognition own INSERT/UPDATE each affected one row. Same-org admin removal cleared one membership, changed two roster statuses and removed one compliance record. Award DELETE was already denied (42501).
- `/private/tmp/trak47-parked-db-audit.log`, `/private/tmp/trak47-parked-native-audit.log`, `/private/tmp/trak47-observed-db-results.json`.
- Tests needing trusted-path adaptation: `coach_departure_review.sql`, `academy_access_security.sql`, `account_deletion_assertions.sql`; `academy_isolation.sql` has a fallback that must remain meaningful. Retain all departure, transfer, account-deletion and historical-read assertions. Add explicit application RPC denial plus trusted operator success, instead of deleting existing invariants.

## Execution and review ledger

- [x] Post shared-file and migration reservation before product edits: https://trakfootball.slack.com/archives/C0C2N0D1C06/p1790265022737219 . The message's native minor version was a transcription error: executed native evidence is PostgreSQL **17.11**, not 17.10.
- [x] Create native isolated worktree and branch. Integrate exact #115 and #116 dependencies atop #119; integration commit `6a80576`. Baseline: 762 source tests, harness, typecheck, build, lint and use-case gate pass; UC-C02's three pending tests are expected red at baseline.
- [x] Add `src/__tests__/parked-feature-boundary.test.tsx`. Run with unchanged UC-C02: **16 red, 8 green** before UI changes. This includes three new coach-entry assertions beyond the original 18-check audit.
- [x] Implement route/entry-point changes in the six named UI files. Run 21 boundary checks + 3 UC-C02 + 8 consent regressions: **32 green**. Keep dormant Quick Assess component consent checks separate from its now-retired route.
- [x] Update mobile expectations for parked Alerts while retaining P0 child switching; extend G7 browser coverage to recognition, awards, all club routes, account exit and coach redirects. All **13 browser journeys pass** at 390x844 against the production build with synthetic intercepted APIs.
- [x] Full UI checks: **783 source tests pass**, 9 baseline skips; harness/typecheck/build/lint/bundle scan pass. Lint has 125 warnings and no errors. UC-C03 initially failed only because it asserted the old Add Player copy; update both empty and failed-load absence selectors, retain response-settle and add explicit error assertion. Registry/lock/UC-C02 untouched.
- [x] SQL: 88 migrations replayed; new boundary suite and all 19 registered SQL suites pass on PGlite 18.3 and native PostgreSQL 17.11. The 157 boundary checks also pass after reapplying the forward migration. Existing policy/grant parity, 78 account-deletion assertions and trusted departure/history checks pass. Expected closure suite was observed red on both engines before migration.
- [x] Separate internal spec and code-quality reviews of UI and SQL have no actionable findings. These are internal checks, not independent team approval.
- [ ] Commit green with mandatory hooks, push Tarek's fork, prepare exact review evidence. Open PR only after named reviewer agrees criteria. Never merge or deploy in this work.

## Commands and evidence

Use the installed Node22 binary in PATH; no production credentials. UI commands: `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run build`, `npm run lint`, `npm run uc:check`, `npm run check:bundle`. Focused command: `node node_modules/vitest/vitest.mjs run src/__tests__/parked-feature-boundary.test.tsx tests/usecases/coach/UC-C02.no-coach-add-player.test.tsx src/pages/coach/__tests__/assess-consent-notice.test.tsx`. Browser: `node node_modules/@playwright/test/cli.js test --config playwright.pilot.config.ts` with installed Chromium executable.

New DB mode: `node scripts/test-db.mjs --parked-feature-boundary`. The native runner on this dependency stack predates #131's registry-driven discovery; use the recorded disposable native replay rather than duplicating that reviewed runner change. All evidence remains local until approved team handoff. UC-C02 stays pending because UI success does not supply TRAK-48's backend roster INSERT proof; 14 other use cases still lack tests.

Canonical main advanced to `e7e40bd` (#121 parent coach messages) during final verification. Integrate it after the green implementation commit, preserve both parent browser edits, and rerun all UI gates and mobile journeys before the branch is pushed. No database files changed on that main advance.

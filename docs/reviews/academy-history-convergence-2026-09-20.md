# Academy history: #34 / #44 convergence repair

September 20, 2026. This candidate combines Imad's #34 `805ccb2` and Kostas's #44 `8e72e80` (which includes main `4335e89`), then adds one forward migration. The published migration files match both parents byte for byte. No production database, Auth account, configuration or deployed artifact was changed.

## Defect and resulting behavior

Both PRs replace `pin_org_id_on_update` and `set_squad_player_org_id`. On native PostgreSQL 17.11, 75-migration fresh replay and main→#34→#44 fail the actual-role check that a coach joining another academy cannot read closed-academy history. Main→#44→#34 protects that history but fails #44's genuine first-attribution case. The final function definitions differ by application order.

The new `20260920152925_preserve_closed_academy_history.sql`, created using Supabase CLI 2.117.0, runs after both dependencies. It preserves the roster closure marker and departed status, rejects retargeting closed history to another player, keeps closed assessments/awards unattributed after later bookkeeping, permits real FK cleanup, and retains first attribution for genuinely unattributed records. No password, consent, public-signup or new linking workflow is introduced.

The two child-record tables have a NOT NULL roster FK with ON DELETE CASCADE, so their protected roster marker is the durable distinction between closed history and first attribution. Trigger functions have an empty search path and explicit qualified references; application-role direct EXECUTE is revoked. Existing triggers still execute normally.

The previous replacement allowed marker edits. A stored closure marker combined with a live academy reference is consequently ambiguous: it could represent reattribution or a forged marker. The migration refuses that state before changing functions, instead of guessing historical ownership. Such a database needs an explicit reviewed repair manifest. Unmarked historical NULL rows are not proof of a deleted academy and are not mass-converted here.

## Regression evidence

- **Native PostgreSQL 17.11, three histories:** fresh, released main→#44→#34, and released main→#34→#44. All 76 migrations replay; both owners' history suites pass and final function definitions converge.
- **Native full/upgrade runners:** all ten suite files pass, including the committed account-deletion fixtures/assertions. Both use disposable Unix-socket clusters which are stopped and removed afterward.
- **PGlite full/upgrade:** all ten suite files pass, including 284 operational-view assertions and 78 account-deletion assertions.
- **Permanent convergence/mutation script:** all three histories agree on function definitions, comments and ACLs. Removing the closed-record guard, first-attribution branch or roster closure guard causes the relevant actual SQL suite to fail. Ambiguous legacy data is rejected before any partial function update.
- **Existing concurrency regression:** three native overlapping-connection cases pass (same player/no stub, same player/stub, different players). These protect the inherited legacy implementation; they do not establish readiness of the replacement academy-assignment flow.
- **Application checks:** 485 source tests pass, nine diagnostic tests remain skipped; 17 harness tests and 14 native-runner safeguards pass. Typecheck/build pass. All five production-build parent browser journeys pass using synthetic intercepted services.
- **Lint:** zero errors, 137 warnings across the integrated tree; the edited scripts/test fixture have zero warnings. No claim that the inherited warning backlog was eliminated.
- **Use-case gate:** exits zero with two enforced cases; still reports three pending UC-A02 failures and 15 pending cases without tests. Tarek owns the agreed coach-only retirement; these are not labelled passed here.
- **Existing #44 convergence:** shared-feedback policy/grants/comment converge, with DELETE unavailable and its privacy suite passing.
- **Supabase security advisor on the disposable socket DB:** no errors; one warning for the existing #44 helper `public.export_scope_includes_observations` having a mutable search path. Neither repaired trigger is flagged. The CLI's generic “Connecting to remote database” log refers here to the explicitly supplied private Unix socket, not a remote service.

## Runner integration

CI retains both parents' test steps, adds the history convergence/mutation command, and preserves current migration filename validation. The older academy migration must replay after its deployed dependencies but **before** its forward correction. Both emulator and native runner use that order. The isolated migration-input fixture now copies the native helper it imports; collision and conflict-copy tests still exercise the real runner and prove validation happens before SQL.

The current #42 registry remains Tarek-owned and unmerged into this candidate. Supply/review these integration hunks when #42 lands; retain suite discovery, the shared validator, the forward order and all active suite pragmas. Do not replace its current runner with an older whole file.

## Commands

```sh
npm test
npm run test:harness
npm run test:db:runner
npm run typecheck
npm run build
npm run lint
npm run test:db
npm run test:db -- --academy-upgrade-review
npm run test:db:academy-history
npm run test:db:convergence
npm run test:db:native
npm run test:db:native -- --academy-upgrade-review
npm run test:db:concurrency
npx playwright test --config playwright.pilot.config.ts
npm run test:usecases
```

For local advisors, use the native runner with the explicitly discovered `TRAK_TEST_SUPABASE_BIN` absolute path. It strips inherited database/service credentials and creates its own cluster; never substitute `--linked` or a production connection string.

## Review and release dependencies

Independent current-head review remains required. #34 depends on #44's exact reviewed changes; neither has production approval here. #36/#37 still carry the older #34 snapshot and must be updated consistently before their release. The shared test-db merge hunk needs coordination with Tarek's #42 registry.

The legacy code-based linking/manual roster path is inherited and still requires the planned admission cutover. This repair preserves history; it does not make legacy admission the pilot architecture. #74, household/P2 authority, adult transition, historical adoption, AI/export/deletion composition and all real-child gates remain separate, incomplete requirements.

Before production: inspect aggregate preflight conditions, resolve any ambiguous history with reviewed stable IDs, verify the exact release dependency order, obtain explicit production approval, and verify with designated synthetic identities. Recover forward without removing closure markers or reopening departed-coach access. Do not reset migration history or rewrite the published files to alter ordering.

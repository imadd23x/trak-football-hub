# Parent pilot integration — September 18, 2026

Branch `parent/P3-pilot-integration` starts at green history candidate `a2bda4b9cc08a9113c614efecc330f57c91d3cc4`, including canonical main `00910940f596d9fe9a7cd416dc741943d1df2cc9` and PR49's retained/null-coach handling. This is local integration evidence, not deployment or pilot approval.

## Included review heads

| Change | Exact head | Local merge |
|---|---|---|
| PR48 Settings identity boundaries | `43db21e6a0807580a657e4ecbc53ce7cbffe5c51` | `5f69587` |
| PR50 parent consent-screen recovery | `6d3bb25c1b1a212d73929abc88511a71f9d131a7` | `33435c5` |
| PR38 date-only consent calendar correction | `8190b403424add68512b718089c49cca61b8106d` | Merge containing this evidence |

The Settings and calendar merges were automatic. The consent merge had one conflict: Playwright's test list. Its resolution retains invitation, family, history and consent specs. No application conflict required a manual change.

Settings/Auth files, consent component/boundary/tests and calendar helper/tests are byte-identical to their respective reviewed heads. History components, hooks, SQL and migration-order helpers are unchanged from the initial integration head. `parent-data.ts` retains history pagination/summary and nullable-author behavior while reexporting the strict consent reader; generated types include both history RPCs and the two existing consent RPCs. Every original CI step remains, with the calendar time-zone step added. Production jobs are unchanged.

No consent policy, SQL migration, historical fixture or backend authorization contract was changed. This combines the existing client repairs; it does not implement the separate academy-specific P2 design or resolve the backend consent-policy work.

## Fresh local verification

Node 22.23.1; PGlite 0.5.8 / PostgreSQL 18.3. Each merge was checked before continuing: Settings with history passed 119 focused tests plus typecheck; consent with Settings/history passed 126 focused tests plus typecheck. Final combined checks:

| Command | Observed result |
|---|---|
| `npm test` | 455/455 tests across 35 source files pass, including the combined account journey below |
| `npm run test:harness` | 17/17 tests across four files pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass; existing bundle-size warning remains |
| `npm run lint` | Zero errors, 129 warnings |
| `npm run uc:check` | Exit 0; two enforced cases pass. Three existing pending UC-A02 assertions fail for removed `/player/log`; 15 cases remain pending without tests |
| `npm run test:db` | Fresh 63-migration replay; parent invitation suite, 282 reporting assertions and 81 history assertions pass |
| `npm run test:db -- --parent-upgrade-review` | Report-before-P1 order; same 63 migrations and three SQL suites pass |
| `node --test tests/db/parent-history-upgrade.test.mjs` | 5/5 pinned-file/order/output safeguards pass |
| `npm run test:db -- --parent-history-upgrade-review` | All 62 immutable main migrations applied first; both history RPCs observed absent at that boundary; unchanged history migration applied next; 55 invitation, 282 reporting and 81 history assertions pass |
| `npm run test:consent-timezones` | 39/39 tests pass separately in UTC, Asia/Dubai, Europe/Athens and America/New_York |
| `node node_modules/@playwright/test/cli.js test --config playwright.pilot.config.ts --list` | Eight journeys registered across four files; no browser or preview server launched |

Registered browser journeys: public invitation privacy; shared-phone account switching; expired/foreign invitation handling; second-child acceptance with recovery/reload; multi-child family views; complete 1,001-match history with page recovery/backfills; malformed consent response recovery; and saved approval followed by failed-refresh recovery and fresh-child continuation. Registration is not a browser pass. CI must execute all eight against this integrated build.

Local logs are `/private/tmp/trak-parent-integration-{settings-focused,settings-types,consent-focused,consent-types,source,harness,typecheck,build,lint,usecases,db-fresh,db-parent-upgrade,db-upgrade-guards,db-history-upgrade,timezones,browser-list}.log`.

## Combined consent and Settings journey

`src/pages/parent/__tests__/parent-account-integration.test.tsx` uses the real App, router, AuthProvider, family provider and Supabase SDK with intercepted synthetic HTTP. Parent A opens Consent from Home and submits a held approval for Alex. The fixture verifies A's bearer and child ID, observes the SDK request being cancelled on browser Back, and retains the pending synthetic server operation. A visits Profile and Settings with both linked children; a failed logout preserves the account and a retry signs out. B then signs in through the real form, sees only Sam, and starts an unfinished name draft. Completing A's held server handler leaves B's account, route, family and draft unchanged and causes no extra grant, logout or pending-approval read.

The focused test, typecheck and targeted ESLint pass. Removing only the Consent cleanup's request cancellation makes the test fail at the observed cancellation assertion; restoring the exact original application bytes makes it pass again. This control verifies cancellation, not server rollback or every possible late callback. The server may already have received the original write. Root review confirmed Settings/Auth and Consent remain byte-identical to their reviewed heads, then reran the full source suite: **455 passed**, recorded in `/private/tmp/trak-parent-integration-final-source.log`.

## Limits and next verification

This work used synthetic intercepted HTTP and disposable in-memory SQL. No local browser execution, fresh native PostgreSQL/PostgREST run, hosted account, hosted write, email, Storage operation or production deployment is included. Prior native/browser evidence remains attached to the original reviewed candidates and must not be relabeled as an integrated run. The combined source journey above establishes client isolation only; hosted CI, independent review and separately approved deployment/live verification remain outstanding. A temporary dependency symlink is untracked and excluded from commits.

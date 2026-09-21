# PR34: refresh onto main 0091094

September 18, 2026. Local merge of main `00910940f596d9fe9a7cd416dc741943d1df2cc9` into PR34 head `ea2c7597b9abbd674bbfc1c94b3dda8f9575f129`. This is fork review evidence, not deployment or pilot approval.

The three additive conflicts were CI, package scripts and the PGlite runner. The resolution retains every main test step and both production jobs, the PR34 native runner/concurrency checks, and all original academy SQL fixtures. It adds an explicit academy upgrade target to both database engines and CI. No application component, historical migration, product policy or teammate candidate was edited during this refresh. The only migration difference from main remains the unchanged 218-line `20260918062345_preserve_academy_access_and_fk_cleanup.sql`.

## Replay contract

Fresh replay applies all 63 files in filename order. Upgrade replay applies all 62 main files, keeping the report-before-P1 order already covered by main's parent upgrade regression, then applies PR34's older academy migration last. Both modes retain the real parent, reporting and academy backfill fixtures at their migration boundaries. The committed four-role account-deletion fixtures run last, after every suite that expects clean synthetic identities.

`migrationReplayOrder()` is shared between engines. Runner tests require the exact migration set with no omissions/duplicates, the academy repair after the latest main quota migration, report-before-parent ordering, setup/assertion adjacency, and all six suite files with committed deletion last. This models the upgrade against repository SQL; a matching live migration-version inventory alone does not prove live SQL bytes, application order, schema or data.

## Fresh local results

Node 22.23.1; PGlite 0.5.8 / PostgreSQL 18.3; native Homebrew PostgreSQL 17.11. All native checks used newly created private Unix-socket clusters with TCP disabled and inherited database settings removed. Every cluster stopped and its temporary directory was removed.

| Command | Observed result |
|---|---|
| `npm run test:db` | 63 migrations; parent suite and 282 reporting assertions pass |
| `npm run test:db -- --parent-upgrade-review` | 63 migrations in report-before-parent order; parent suite and 282 reporting assertions pass |
| `npm run test:db -- --coach-departure-review` | 63 migrations; departure audit, academy-access suite and 78 committed deletion assertions pass |
| `npm run test:db -- --academy-upgrade-review` | 62 main migrations then unchanged academy repair; all six suite files pass, including 282 reporting and 78 deletion assertions |
| `npm run test:db:runner` | 14/14 safeguard and replay-plan tests pass |
| `npm run test:db:native -- --academy-upgrade-review` | PostgreSQL 17.11: same 63-migration upgrade and all six suite files pass |
| `npm run test:db:concurrency` | PostgreSQL 17.11: fresh 63-migration replay and all sequential suites pass; all three real two-connection races pass |
| `npm test` | 320 tests pass in 29 files |
| `npm run test:harness` | 17 tests pass in four files |
| `npm run typecheck` / `npm run build` | Both pass; existing large-bundle warning remains |
| `npm run lint` | Zero errors, 136 warnings |
| `npm run uc:check` | Exit 0: two enforced cases pass; 15 cases remain pending without tests. Three existing pending UC-A02 assertions still fail because `/player/log` is no longer a route |

Set `TRAK_TEST_PG_BIN=/opt/homebrew/opt/postgresql@17/bin` for the native commands on this Mac, or the absolute PostgreSQL 17 binary directory on another machine. CI uses `/usr/lib/postgresql/17/bin`.

The concurrency cases observe both independent RPC sessions waiting before releasing the third-connection blocker. Same-player calls with an empty roster and with an existing stub return one shared row with no duplicate; competing different players receive their own rows. Stub assessment history survives.

## Negative controls

These commands intentionally exit 1; their failure is evidence that the desired assertions reject the vulnerable versions, never a passing release check.

| Command | Observed failure |
|---|---|
| `npm run test:db -- --baseline` | 57 migrations; foreign-email parent invitation claim incorrectly permitted |
| `npm run test:db -- --coach-departure-baseline` | 60 migrations; five desired assertions fail across F1 stable academy profile/DOB access and F6 academy deletion/FK cleanup |
| `npm run test:db -- --pilot-views-baseline` | 61 migrations; 246 reporting assertions fail |
| `npm run test:db:concurrency -- --historical-link-rpc` | Fresh replay followed by the exact original link function: both same-player cases produce two rows and one duplicate-player group; distinct-player control still passes; cluster cleanup succeeds |

## Limits

No hosted SQL, production change, push, browser run or fresh security-advisor run is included in this local refresh. The earlier advisor result is historical and must not be presented as a current result. These SQL tests do not verify Auth HTTP, Storage cleanup, email delivery, real-world child identity or every deletion-retention category. [Remaining deletion findings](account-deletion-followups.md) still apply. Peer review, hosted CI and separately approved deployment/live checks remain outstanding.

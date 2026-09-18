# PR36: refresh onto main and PR34

September 18, 2026. Merged tested PR34 `805ccb2da36a044f33abb8f4d575a781c19c6723` (including main `00910940f596d9fe9a7cd416dc741943d1df2cc9`) into PR36 `0c883c652461a9912205f611d4b2e85cc2857996` on `shared/S2-demo-review`.

The conflicts were main's later edits to `check-pilot-state.mjs` and `seed-pilot-rehearsal.mjs`. Both retain PR36's complete retirement notice and nonzero exit; restoring their old live-target behavior would undo the purpose of this change. Demo plan/apply/CLI implementation is unchanged. All current-main and PR34 CI checks, native runner and production jobs remain. There is no new migration in PR36; its migration directory is identical to PR34.

The actual-schema demo fixture now reuses the shared migration ordering helper. Its fresh-apply/exact-repeat test runs both filename order and the current-main→academy upgrade order. It requires no second-run writes, identical complete stored rows, and an untouched unrelated identity. This adds one executable regression to the existing role isolation, adoption/history, interrupted-response recovery and CLI boundary coverage.

## Fresh local evidence

Node 22.23.1; PGlite 0.5.8 / PostgreSQL 18.3; native PostgreSQL 17.11. Commands run from this branch after the merge resolution:

| Command | Result |
|---|---|
| `npm run test:demo` | 38/38 pass; each SQL fixture replays 63 real migrations, including the new upgrade-order repeat case |
| `npm run test:db -- --academy-upgrade-review` | 62 main migrations then unchanged academy repair; all six suite files pass, including 282 reporting and 78 deletion assertions |
| `npm run test:db:native -- --academy-upgrade-review` | Same 63-migration upgrade and six suites pass on PostgreSQL 17.11; owned cluster stopped and removed |
| `npm run test:db:runner` | 14/14 pass |
| `npm test` / `npm run test:harness` | 320/320 source and 17/17 harness tests pass |
| `npm run typecheck` / `npm run build` | Both pass; existing bundle-size warning remains |
| `npm run lint` | Zero errors, 136 warnings |
| `npm run uc:check` | Exit 0; two enforced cases pass. Three existing pending UC-A02 assertions still fail for removed `/player/log`; 15 cases remain pending without tests |

For native commands on this Mac set `TRAK_TEST_PG_BIN=/opt/homebrew/opt/postgresql@17/bin`. No test contacts a hosted target. The SQL adapter uses real roles/RLS but substitutes the Auth Admin transport; this does not prove hosted provisioning, login, email, phones or pilot readiness. No browser or new advisor result is claimed. Peer review, fork/hosted CI and any separately authorized demo apply remain outstanding. Existing unrelated `node_modules` is untracked and preserved.

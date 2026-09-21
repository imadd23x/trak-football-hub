# PR37: refresh onto main and PR34

September 18, 2026. Merged tested PR34 `805ccb2da36a044f33abb8f4d575a781c19c6723` (including main `00910940f596d9fe9a7cd416dc741943d1df2cc9`) into PR37 `d461596347927a2dfe8085760ce8f1e49db6e658` on `shared/assessment-query-review`.

CI and package-script conflicts were resolved additively. Every existing main and refreshed PR34 check remains, including parent/academy upgrade modes, native concurrency and native academy upgrade. Production jobs are unchanged. The original nine-line `20260918080430_index_coach_assessment_history.sql` is byte-identical (SHA-256 `2688128ba48ee65cb70cf1b999f6560f9116cce2d4e55d655fdd1d401612fc7b`); no component, policy or historical migration was rewritten.

## Upgrade and test contract

The new shared `--assessment-upgrade-review` mode replays all 62 main migrations, then the older PR34 academy repair, then the older PR37 index. It retains the existing report-before-P1 deployment model. Both engines use this same ordering; runner tests require every real migration exactly once, the last two filenames in the intended order, current main's quota migration before both, and all six SQL suite files with committed deletion last. An absent required migration fails the plan.

CI runs the PGlite mode and native `test:db:query-plans`. The native performance runner now starts with this upgrade plan, proves the expected index definition, removes only that index to establish its baseline, then applies the actual immutable file. Fresh filename-order replay remains covered by the default PGlite suite and native concurrency runner.

## Fresh local results

Node 22.23.1; PGlite 0.5.8 / PostgreSQL 18.3; native PostgreSQL 17.11. Set `TRAK_TEST_PG_BIN=/opt/homebrew/opt/postgresql@17/bin` for native commands on this Mac, or the absolute PostgreSQL 17 binary directory elsewhere.

| Command | Result |
|---|---|
| `npm run test:db -- --assessment-upgrade-review` | Intended 64-migration upgrade; all six suites pass, including 282 reporting and 78 deletion assertions |
| `npm run test:db` | Fresh 64-migration replay; parent suite and 282 reporting assertions pass |
| `npm run test:db -- --parent-upgrade-review` | Report-before-parent order; parent suite and 282 reporting assertions pass |
| `npm run test:db -- --academy-upgrade-review` | Existing academy-last compatibility mode; all six suites pass |
| `npm run test:db:query-plans` | Native intended upgrade, all sequential suites and complete authenticated result/index checks pass |
| `npm run test:db:concurrency` | Native fresh 64-migration replay, all sequential suites and all three real two-connection linking races pass |
| `npm run test:db:runner` | 15/15 pass |
| `npm test` / `npm run test:harness` | 320/320 source and 17/17 harness tests pass |
| `npm run typecheck` / `npm run build` | Both pass; existing bundle-size warning remains |
| `npm run lint` | Zero errors, 136 warnings |
| `npm run uc:check` | Exit 0; two enforced cases pass. Three existing pending UC-A02 assertions still fail for removed `/player/log`; 15 cases remain pending without tests |

Native query fixtures contain 20 academies/admins/coaches, 600 linked adults, 600 roster rows and 31,100 assessments. Sequential-suite fixtures bring total roster/assessment counts to 604/31,104. Complete query result rows, fixture fingerprints and RLS policy fingerprints match before/after. The Home feed returns the expected five newest rows with player names; its plan uses the new index only in the indexed phase. All captures execute as the real authenticated coach. Five separate connections produce identical results, with observed execution overlap in both phases.

The local latest-five observation was 106.360 ms without the index and 2.836 ms with it. Index build observation was 10.438 ms and size 1,277,952 bytes. No timing threshold is asserted, and these numbers are not a production latency, write-lock or capacity forecast. The full synthetic report is locally at `/private/tmp/trak-query-report-xFq7lz/report.json`; the existing CI artifact step preserves rerun reports for 14 days. The committed runner is the portable evidence.

All owned native clusters were stopped and removed. No hosted SQL, production change, push, browser run or new advisor run occurred. Existing index write-lock/storage costs, timestamp-tie behavior and unbounded history callers remain as documented in the [original scope](../plans/coach-assessment-index.md). This branch does not implement a latest-per-player API or change K7's history contract. Peer review and hosted CI remain outstanding; a matching live version inventory alone would not prove live SQL bytes, order or data.

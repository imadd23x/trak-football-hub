# PR37: assessment index with academy-history convergence

September 20, 2026. Integrates PR34 `5af5ac2c7d5e4e2643a2e78274833bcbffad2ef5`, including PR44 `8e72e80` and canonical main `4335e8984777b7b704e8706d3fe277352658c9ed`, into PR37's existing `b8c3a19` branch. No application code is changed relative to PR34. Both dependencies still need release review and authorization.

## Resolution and scope

CI retains the consent-timezone checks, all database/security checks, the new three-history convergence/mutation check, and PR37's native query regression plus JSON artifact. The shared filename validator is retained. All ten SQL suite files run in assessment-upgrade mode, with committed deletion fixtures last.

The upgrade sequence applies the released/dependency migrations, the original academy repair, its new forward correction, then the original index. The runner test requires all migration files exactly once and that final three-file order. Fresh filename-order coverage remains in CI. No published migration was renamed or edited. The index migration's SHA-256 is still `2688128ba48ee65cb70cf1b999f6560f9116cce2d4e55d655fdd1d401612fc7b`.

## Verification on the integrated source

- `node --test scripts/test-native-db.test.mjs`: 15/15 pass.
- `npm run test:db -- --assessment-upgrade-review`: 77 migrations, all ten suite files pass, including 284 operational-view and 78 deletion assertions.
- `npm run test:db:academy-history`: fresh and both historical orders converge. Removing any of the three closure guards is detected; ambiguous legacy attribution stops before partially changing functions.
- `npm run test:db:query-plans`: native PostgreSQL 17.11 runs that upgrade order and all suites before testing the actual index absent/present. Complete query results, fixture rows and RLS policies are unchanged.
- `npm test`: 485 pass; nine diagnostic findings tests remain explicitly skipped. Typecheck, build and production bundle credential check pass. Lint reports zero errors and 137 inherited warnings.

The query fixture contains 20 academies/coaches, 600 linked adult players/rosters and 31,100 synthetic assessments (31,104 including sequential test fixtures). The latest-five feed uses the named index only after creation. Five independent connections overlap in each phase and return identical rows. The local latest-five observations are 72.635 ms without the index and 2.481 ms with it; overlapping requests range from 88.214–104.360 ms before to 2.973–5.045 ms after. Shared hit blocks decrease from 30,793 to 2,137. The 30-row latest-per-player candidate equals the corresponding full-history derivation, but no application consumer is switched to it here.

The index is 1,277,952 bytes. Its observed database build time is 8.517 ms (19.085 ms client wall time). These measurements are samples, never passing thresholds or hosted latency/lock forecasts. Full-history queries still take roughly 72–75 ms in this fixture and remain unbounded. CAP-01's hosted multi-role/cold/warm/recovery checks remain outstanding under Tarek's ownership. Existing equal-timestamp nondeterminism and ordinary index creation's write lock remain documented in the original plan.

Local machine report: `/private/tmp/trak-query-report-z6nf5d/report.json`; CI publishes the repeatable runner's synthetic report for 14 days. All owned native clusters were stopped and removed. No hosted benchmark, production schema/Auth/configuration change or deployment was performed. An index correction must be a new forward migration; do not rewrite released history or undo the academy-history protection. Rebase/merge onto delivered dependencies and rerun before release, obtain independent current-head review and migration-order acknowledgement, then ask Imad for production approval.

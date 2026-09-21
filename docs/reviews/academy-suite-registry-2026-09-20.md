# Academy test registration for PR42 integration

September 20, 2026. These declarations make the existing academy/deletion scenarios discoverable by Tarek's registry at `918d8c3`, without changing any SQL body or migration. The existing runners remain intact pending the explicit runner merge hunk.

## Verified correction

The proposed five declarations classified both committed account-deletion files as fixtures. Composed with the actual PR42 registry, the command exited zero and printed nine passing suites, but neither deletion setup nor assertions ran. An independent disposable PGlite reproduction confirmed this omission. Migration-boundary fixtures and the paired committed deletion scenario need different declarations.

The six corrected headers are:

| File | Declaration |
|---|---|
| `academy_orphan_backfill_setup.sql` | `@trak-fixture` |
| `academy_orphan_backfill_assertions.sql` | `@trak-fixture` |
| `coach_departure_review.sql` | `@trak-suite mode=--coach-departure-review in-all=true` |
| `academy_access_security.sql` | `@trak-suite mode=--coach-departure-review in-all=true` |
| `account_deletion_setup.sql` | `@trak-suite mode=--coach-departure-review in-all=true order=1000` |
| `account_deletion_assertions.sql` | `@trak-suite mode=--coach-departure-review in-all=true order=1001` |

Grouping access under the existing coach-departure flag preserves that command's four-file coverage. Its former `--academy-access-review` declaration was not an accepted mode in the existing hardcoded runner. Deletion setup commits before assertions and runs after all ordinary rollback-only suites. Treating both files as ordinary automatically unordered suites would also be wrong.

With these declarations, the actual PR42 registry runs eleven files under `--all` (the existing ten plus PR42 academy isolation), including both deletion files last. The dedicated coach mode runs all four original files. Both composed runs pass, with 284 view assertions. Reproduction used current academy SQL bodies, PR42's existing pragmas for shared files and its added isolation/adoption suites; it did not overwrite newer SQL assertions with old whole-file copies.

The unchanged current PR34 runner also passes fresh, coach-departure and academy-upgrade modes, including all 78 committed deletion assertions. PR36's 38 demo tests and PR37's 77-migration assessment-upgrade run pass with the same headers. Header removal comparison verifies every existing SQL body is byte-identical. No migration bytes changed, and no hosted database was used.

## Remaining runner handoff

PR42's runner cannot simply replace the current runner wholesale. Independently invoking its raw file with `--academy-upgrade-review` exits with Usage; it also lacks the academy orphan backfill boundary hooks. The integration must keep `migrationReplayOrder`, academy upgrade/baseline modes, before/after orphan fixtures and the printed deletion assertion count, plus PR37's assessment upgrade mode, while replacing the hardcoded suite selection with the registry. Preserve negative controls and the existing CI commands. This header change does not claim that final runner integration is already delivered.

Tarek's September 20 conditional acceptance covered suite/runner integration, not the history-trigger semantics. His review finding about the constant SECURITY INVOKER export helper is advisor hygiene; no exploit was established. Kostas still owns trigger review and that export cleanup. Independent review of the corrected declarations and the eventual runner hunk remains required. No production approval is implied.

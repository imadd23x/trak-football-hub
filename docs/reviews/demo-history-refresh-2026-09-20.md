# PR36: synthetic demo with academy-history convergence

September 20, 2026. Integrates PR34 `5af5ac2c7d5e4e2643a2e78274833bcbffad2ef5`, including PR44 `8e72e80` and main `4335e8984777b7b704e8706d3fe277352658c9ed`, into PR36's existing `efb7b0a` branch. No new schema migration or application code is added relative to PR34. The entire migration directory is byte-identical to that dependency; original PR36 migration bytes also remain unchanged.

## Conflict resolution

- CI retains both the demo regressions and consent-timezone step, plus the complete PR34 history/convergence/native safeguards. Production jobs remain unchanged.
- The three legacy seed/probe entry points remain non-network retirement wrappers. The merge does not restore the old implicit-target seed scripts just because main externalized their passwords.
- The Markdown runbook uses the explicit-target demo guide. The historical HTML walkthrough now identifies its retired account scheme instead of instructing users to assume a shared password.
- CLAUDE guidance retains credential containment and explains that frontend environment values are not server secrets. It distinguishes the old dev-setup path from current admission/consent evidence.
- Standalone demo database tests now use the shared migration filename/version validator, so cloud-sync copies and duplicate versions cannot silently change the schema under those tests.

## Fresh verification

| Check | Result |
|---|---|
| `npm run test:demo` | 38/38 pass against 76 real migrations; both fresh and deployed-dependency-before-academy upgrade orders |
| `npm run test:db -- --academy-upgrade-review` | All ten suite files pass; 284 view and 78 deletion assertions |
| `npm run test:db:academy-history` | Three histories converge; all three deliberately broken guards caught; ambiguous legacy attribution refuses before partial function changes |
| `node --test scripts/test-native-db.test.mjs` | 14/14 pass |
| `npm test` | 485 pass; nine diagnostic tests explicitly skipped |
| Typecheck/build/bundle credential check | Pass |
| Lint | Zero errors; 137 inherited warnings |

Demo tests exercise actual SQL roles, two-child parent reads, foreign-academy denial, preservation of unrelated identities, exact repeated application with zero second-run writes, partial-write recovery and lost-response recovery. Test-only Auth adapters do not call a hosted service. Two extra isolated executions of the actual demo database test entry point prove an invalid conflict-copy filename and a duplicate numeric version are rejected before executing any migration. The source test suite separately covers the shared validator through the main runner.

The demo still contains adult history, pending seventeen-year-old/missing-age cases with no development records, and the legacy adoption/history fixture. It seeds no consent, private feedback, AI publications, telemetry or global pilot configuration. That adoption test preserves historical behavior; it is not the approved household admission design. Before using this tool with the new staff/household cutover, adapt fixtures to the approved admission interfaces and rerun them without bypassing the new gates.

No hosted seed, production SQL/Auth/configuration change, real login/email test or deployment was performed. Admin API behavior, partial Auth/REST transactions and local-only operator locking retain the limits in [the demo guide](../demo-data.md). Retiring scripts does not revoke existing legacy credentials. Independent current-head review, delivery of #44/#34, refreshed release checks and explicit production approval remain outstanding. Do not restore purge/reset scripts as rollback; preserve exact synthetic IDs and existing records for an explicitly reviewed recovery.

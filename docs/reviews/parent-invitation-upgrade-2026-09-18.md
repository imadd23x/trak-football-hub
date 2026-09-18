# Parent invitation release candidate after PR35

PR33's parent/Auth/Edge/browser implementation and migration remain unchanged
from `88e406c`. This update merges deployed canonical main `09d22d4`, retains its
operational-report repairs, and combines the two database test runners. Both
ordinary and actual deployment-order replay run in CI. Human review and explicit
production approval remain required; this record is not a deployment claim.

The read-only Supabase ledger check on September 18 showed 58 applied migrations,
ending in `20260918070209_restrict_pilot_operational_views`. P1's unchanged
`20260917205027_secure_parent_invites` was absent. This candidate has exactly one
pending migration relative to that ledger: P1.

The workflow now previews and applies pending versions using `--include-all`.
That includes every migration absent from the remote ledger, not only P1; it
does not rename or reapply an applied version. Review the ledger/candidate again
before release if either changes. The dry run logs the plan and fails the step
on error; it is not a human approval pause. Behavior follows the
[Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push).

## Verification

- All 238 existing source tests and 17 harness tests passed. The workflow suite
  then passed all eight tests, including two added cases executing the real
  shell step with a stub CLI: preview precedes apply, and preview failure prevents
  any apply call. No database or CLI executable is invoked by those two cases.
- Typecheck and production build passed. Lint: zero errors, 135 existing warnings.
- All three invitation browser scenarios passed at 390 × 844 with a production
  bundle and intercepted synthetic HTTP. This is separate from the five-test
  integrated family run on fork branch `parent/P7-invitation-family-review`.
- PGlite replayed 59 unchanged migrations in normal filename order and in the
  deployed order (58 main migrations, then P1). Both backfill fixtures, the
  authenticated-role parent suite and all 282 report assertions passed.
- Native PostgreSQL 17.11 also passed the deployed-order replay and both suites,
  then stopped and removed its private, Unix-socket-only test cluster.
- Both negative baselines failed for their expected defects: unauthorized parent
  claim on the old parent schema; 246 report assertions on the old view schema.
- The two enforced use cases pass. Four existing pending player-path assertions
  still fail, and 16 pending use cases lack tests. They are not release evidence
  for those player journeys.

Reproduce durable SQL checks:

```sh
npm run test:db
npm run test:db -- --parent-upgrade-review
npm run test:db:pilot-views
# Negative controls must fail with the expected defect, not arbitrary errors:
npm run test:db -- --baseline
npm run test:db -- --pilot-views-baseline
```

Local evidence is under `/private/tmp/trak-parent-current-*.log`; the native
one-off replay script is `/private/tmp/trak-parent-upgrade-native.mjs`. Permanent
upgrade-order coverage is in `scripts/test-db.mjs` and the workflow. The native
run does not establish hosted Auth/PostgREST or CLI/network behavior.

Deploy the reviewed parent migration and `send-parent-invite` before its frontend,
using the guarded release workflow. Verify the exact resulting deployment and
designated synthetic invitation journeys afterward. Real email, phones, historical
link audit and academy-specific consent remain separate gates. Preserve the
recipient/consumed-invitation restrictions in any forward repair; do not restore
the former anonymous or email-only claim behavior as a rollback.

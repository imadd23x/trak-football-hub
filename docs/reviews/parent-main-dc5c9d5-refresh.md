# Parent integration on deployed main dc5c9d5

September 20, 2026. This refresh combines the existing parent candidate
`0b72e00` with canonical main `dc5c9d5682963fbff73f6117fe766c665db26776`.
It is a fork review candidate, not a production release.

## Scope and acceptance

Preserve the existing parent history, retained-coach history, consent recovery,
Settings account boundaries and date-only calendar corrections, together with
all intervening main changes. The client repairs are the work reviewed in
#38, #48, #49 and #50; this candidate also carries the pending parent history
RPC migration and their combined account journey. Those PRs are not delivered
merely because this integration contains them.

Acceptance: all current main checks remain; account/child switches and retries
remain isolated; the history migration works both fresh and after the complete
deployed schema; an omitted security suite or changed historical migration
fails the upgrade checks. No academy-consent-policy change is included.

## Resolution

The only merge conflict was `scripts/test-db.mjs`. It now retains #68's complete
directory validation before database creation/filtering and executes all four
suites: parent invitations, operational views, privilege/consent security and
parent match history. The upgrade boundary is pinned to all 66 main migrations,
including the known reporting-before-parent order, followed by the unchanged
`20260918112323_parent_match_history.sql`.

The copied runner fixtures include both imported helpers. Upgrade assertions
require the new privilege/consent suite's completion report; a mutated missing
report is exercised through the actual CLI and fails. Existing controls still
reject changed/missing main SQL, unexpected additions, missing history output
and an explicitly failing history assertion.

The second combined account test from the earlier unfinished worktree was
copied and verified here; its original remains untouched. Through the real App,
AuthProvider, router and Supabase SDK with synthetic HTTP, it checks that a
Settings name save preserves the selected second child, a held history request
is cancelled on route departure, and its eventual completion cannot contaminate
the next signed-in parent's family or first history page. No application source
needed manual conflict resolution. Removing only the history query's abort
signal makes the new test fail at its observed cancellation assertion; restoring
the exact source bytes makes both combined tests pass again. This proves request
cancellation, not server rollback.

## Executed verification

- `npm test`: 493 passed, including both combined account journeys and four
  migration-input controls.
- `npm run test:harness`: 17 passed.
- `npm run typecheck`, `npm run build`: passed.
- `npm run lint`: zero errors, 127 existing warnings.
- `npm run test:consent-timezones`: 39 tests passed in each of UTC, Dubai,
  Athens and New York.
- `npm run test:db` and `--parent-upgrade-review`: 67 migrations, all four
  suites pass; 282 operational, 151 privilege/consent and 81 history assertions.
- `node --test tests/db/parent-history-upgrade.test.mjs`: six checks passed,
  including the real 66-main-then-history replay and negative controls.
- Native PostgreSQL 17.11 and Supabase CLI 2.117.0: a private loopback cluster
  applied the immutable main files, preserved reporting-before-parent order,
  verified 66 history entries and absent history RPCs, then pushed the older
  pending history version with `--include-all`. Result: 67 unique versions and
  all four SQL suites passed. The server was stopped in `finally`.
- Local Playwright against the production build: all eight parent browser
  journeys pass (19.3 seconds), using synthetic intercepted HTTP.
- `npm run uc:check`: enforced cases pass; three existing pending UC-A02
  assertions still fail and 15 pending cases have no tests.

Native evidence: `/private/tmp/trak-parent-current-native.log`; script:
`/private/tmp/trak-verify-parent-current-native.py`. Other local logs use
`/private/tmp/trak-parent-current-*.log`. The first browser attempt failed to launch because the expected Chromium was
absent. Installing the official Playwright Chromium into
`/private/tmp/trak-playwright-browsers` resolved that environment failure; the
subsequent run executed and passed all eight journeys.

## Integration and limits

All 66 deployed migration files retain their exact main bytes. The one pending
history migration is unchanged from the prior candidate and predates the live
high-water mark, so preserve its tested upgrade evidence when obtaining review.
Update this candidate and rerun applicable checks after another main change.
Do not replace #42's eventual suite registry with this older explicit list;
carry the history suite and order checks into that registry when integrating it.

No production change, real email delivery, real-device journey or hosted load
test occurred. The native test used synthetic data and does not establish
hosted capacity. Academy-specific under-18 consent remains separate P2 work.
Peer review and explicit production authorization remain required. Before
deployment, discard/revert this candidate if necessary; after a migration is
applied, use a reviewed forward repair rather than rewriting history.

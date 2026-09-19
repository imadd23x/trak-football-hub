# P2 authority foundation — review evidence

Base: deployed `dc5c9d5`, with calendar PR #38 (`8190b40`) integrated as a
dependency. Main's unchanged exact birthday-boundary test failed at 00:40 Dubai
time on September 20; the same test passes with #38. Its boundary was not moved.

This branch adds the new consent authority, not the full P2 cutover. The agreed
contract and remaining release requirements are in
[the implementation plan](../plans/p2-consent-authority-2026-09-20.md).

## Observed local results

- 385 source tests and 17 harness tests passed; typecheck and production build
  passed. The calendar dependency passed 39 assertions in each of UTC, Dubai,
  Athens and New York.
- Fresh and reports-before-parent replay: 67 migrations, four SQL suites,
  including 282 operational-view and 52 new consent assertions. Existing
  parent-invite and privilege/consent suites remain enabled.
- Native PostgreSQL 17.11 replayed all 67 migrations and passed all four SQL
  suites. Four races used independent connections and observed actual blocking
  through `pg_blocking_pids`: identical retry, independent guardians, stale
  grant after withdrawal, and a request ID reused across academies. Event IDs,
  counts, revisions, current decision and SQLSTATE were checked. The disposable
  server was stopped after completion.
- Fault injection: the actual role/RPC suite passed unchanged and failed for
  each deliberate removal of academy scope, independent-guardian approval,
  current-notice matching and stale-event protection. Five runner tests passed.
- Five existing local Chromium parent journeys passed with synthetic HTTP
  fixtures. These do not exercise the new RPC through a real PostgREST server.
- The use-case gate passed its two enforced cases. Three existing pending
  UC-A02 failures and 15 pending cases without tests remain visible.

CI runs the mutation controls and native PostgreSQL races inside the required
test job. Its PostgreSQL service is disposable with synthetic-only credentials;
it does not use any production database configuration. The native script refuses
non-loopback or nonempty databases and accepts only `trak_consent_test`.

## Review and release limits

No academy notice, controller approval or enabled program was invented. No
legacy approval was converted. No new table is exposed to application roles.
There are no UI callers of these RPCs yet, and legacy development/read gates
remain unchanged. No production migration, merge or live role journey is claimed.

Review the entire academy/child ownership, purpose-aware reader/writer, AI,
adult transition, DOB correction, notice, export/erasure and retention cutover
before enabling real-child admission. In particular, race tests here establish
decision serialization, not serialization with development writes. After #42,
retain the `@trak-suite` registration and these native/mutation checks when
reconciling the shared runner. Preserve the parent's separate history-upgrade
boundary controls when combining branches.

# Parent match history: scope and verification

Status: implemented and locally verified in the fork. The original history
review head `484ad20` and integration head `a1e5339` are preserved. The latest
`parent/P3-history-current` refresh and its pinned-main upgrade evidence are
recorded below. No production change is established by this document.

## Observed failure

The parent client currently reads matches with one unbounded request. A synthetic 1,001-row history exercised through the installed Supabase SDK with a 1,000-row response cap produced a 1,000-match Home total, an incorrect average and result count, and omitted a newly recorded older match from Alerts. The hosted API cap has not been measured. The code has no mechanism to retrieve rows beyond whatever limit the server applies.

## Change and acceptance criteria

1. Home reads complete authorized summary totals through a stable invoker RPC and only five recent match records. Missing or invalid summary data is an error, not invented zero totals.
2. Matches displays at most 50 records per page with Previous/Next controls. A date/creation-time/ID cursor reaches older records, including tied dates and nullable timestamps. A failed next page retains the current page and can be retried. Child/account changes cannot display or advance another child's page.
3. Alerts reads the 20 most recently recorded matches independently of match dates, plus bounded assessment/award feeds, and displays the latest 20 combined updates.
4. New SQL functions explicitly require a linked parent and preserve ordinary table RLS. They expose only existing parent-visible match fields. This does not complete the separate P2 consent requirements.
5. Persistent tests cover more than 1,000 records, accurate aggregates, zero and missing ratings, ties/null dates, newer inserts between pages, page limits, unauthorized roles/children, restrictive RLS, network failures, and identity switches. Native PostgreSQL and a browser exercise complement the in-memory database and component tests.

## Verification and rollout

Run source tests, harness tests, type checking, lint, production build, both migration replay orders, native PostgreSQL role tests and bounded-page query plans, and the parent browser journeys. Use only disposable local databases and synthetic browser HTTP responses. Record failures and observed limits below; local timings do not establish hosted capacity.

Commit and push only to `imadd23x/trak-football-hub`; the current review branch is `parent/P3-history-current`, preserving the original `parent/P3-match-history` evidence. Human review and explicit production authorization precede any canonical merge or deployment. Deploy the additive migration before the frontend; verify the two read RPCs, Home totals, an older page and Alerts under an authorized synthetic parent in the target environment when approved.

Rollback the frontend to the prior release if needed; the unused additive functions/index can remain until a reviewed cleanup migration. Do not weaken RLS or change consent rules to resolve rollout failures.

## Results

Verified 18 September 2026 (local Dubai time, final native run 15:45):

- `node node_modules/vitest/vitest.mjs run src`: **287 tests passed** in 22 files. This includes 38 data-boundary tests and 25 parent-family component tests: failed-page retry without skipping, child/account changes, A → B → A with a late request, removed rows, truthful empty states, zero/nonfinite ratings, and keyboard focus.
- `node node_modules/vitest/vitest.mjs run tests/msw tests/support`: **17 tests passed**.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`: passed. `node node_modules/eslint/bin/eslint.js .`: zero errors, 135 existing warnings. Production Vite build passed; the existing large-chunk warning remains.
- `node scripts/test-db.mjs` and `node scripts/test-db.mjs --parent-upgrade-review`: **60 migrations** replayed in fresh-install and deployed-main → P1 → new-history order. Parent invitation assertions, **282 operational-view assertions**, and **81 parent-history assertions** passed. The history fixture walks 1,209 original matches without missing/repeating IDs, inserts a newer match between pages, and exercises all nullable-date/timestamp and infinity boundaries under actual database roles. A raw JSON key assertion ensures the response exposes only the intended fields.
- Disposable negative controls failed as intended: omitting the null-timestamp branch loses records in the full walk; truncating the JSON array to three entries violates the raw 51-row assertion. These were temporary database mutations, not saved migrations.
- Native PostgreSQL **17.11** replay and the same role/assertion suites passed. A separate synthetic load of ten adult families with 10,000 matches each completed ten simultaneous summary + deep-page read pairs correctly, with 42–58 ms elapsed per pair including `psql` process/connection overhead. This is a local sample, not a hosted-capacity or sustained-load claim.
- Native `auto_explain` after seven calls in the same connection verified a cached generic plan: the deep-page branch uses `matches_parent_history_order_idx` with the native tuple in `Index Cond`, reading **51 match rows**, rather than reading 10,000 and discarding 9,001. The nested page query measured 0.218 ms in this sample. Summary aggregation necessarily reads that child's complete authorized history.
- Real **PostgREST 14.18** over a private Unix socket with `db-max-rows=3`: a direct table request returned three rows (control); the scalar JSON page still returned all 51 requested records, the next page began at the exact lookahead record, and the summary returned the full 10,000 count. Another parent received an empty page; anonymous execution was denied. This was a local HTTP check; the hosted PostgREST version/configuration was not changed or measured.
- `node node_modules/@playwright/test/cli.js test --config playwright.pilot.config.ts` against the production build: **6/6 browser journeys passed** (17.1 seconds), including all 21 pages of a 1,001-match synthetic history, failure/retry, backfilled activity, child switching, invitations, membership-refresh recovery and reload. New-page heading focus and the first row being in the phone viewport are asserted. Browser backend traffic is intercepted; hosted auth/email delivery is outside this evidence.
- Use-case gate: six enforced assertions passed. Four existing pending player assertions still fail and 16 pending use cases have no tests; the gate remains green because those are explicitly pending. This does not establish overall pilot readiness.

The native/PostgREST checks used disposable synthetic data and stopped/removed their private cluster and API process. No hosted data, configuration or deployment was changed.

## Design notes and limits

The page RPC returns one scalar JSONB array, rather than a SQL set of match rows, so an API row cap cannot remove the lookahead. The client still receives the ordinary JSON array and validates its fields and maximum size. This follows [PostgREST scalar-function responses](https://postgrest.org/en/stable/references/api/functions.html#scalar-functions), and was confirmed with the deliberately capped local API above.

An initial coalesced cursor expression was correct but PostgreSQL could not use its range condition through RLS. The final natural composite index and seven disjoint, bounded branches cover nullable cursor components without sentinel collisions. Each branch preserves invoker RLS; no planner setting, security-definer function, policy or consent exception was introduced. At most seven times the requested limit reach the final candidate merge.

Pages are live reads, not a frozen snapshot: later edits to a match's sorting fields can move it, and deletions can empty a later page. The UI retains Previous navigation and does not claim the child has no history. Newer inserts do not shift an existing cursor. Home summaries are independent queries and can briefly differ from a concurrently changing page. The app retains already visited pages in its identity-scoped query cache but renders only one page.

P2 consent, feedback review findings, pending player checks, deployment approval and hosted role-journey verification remain separate readiness gates. Existing #32/#33/#39 review heads remain unchanged; this branch has no new PR.

## Current-main integration — 17:03 Dubai, September 18

Merge `e17dc16` incorporates the subsequently merged player and truthful-Settings
work from current main without conflicts or manual application-code resolution.
The original parent history implementation and migration are unchanged. The
family browser test now locates the current **Account settings** entry while
still verifying both linked children; this is the same selector correction
already isolated in the S4 candidate, not a change to the product.

Fresh checks on the integrated branch:

- Source and harness: **347 tests pass across 30 files**.
- TypeScript and production build pass. Lint: **0 errors / 134 existing
  warnings**. The existing large-chunk build warning remains.
- Fresh and deployed-report-first migration orders: **60 migrations** replay,
  parent invitation checks pass, **282 report assertions** and **81 parent
  history assertions** pass in each disposable run.
- Built-app browser: **6/6 journeys pass in 17.0 seconds**, including 1,001
  matches across 21 pages, correct full totals, retry without skipping a page,
  backfilled activity, child switching, a second invitation and reload.
  External requests are intercepted with synthetic responses; no hosted account
  or email was used.
- Use-case gate still exits zero with **2 enforced cases**, but reports **3
  pending UC-A02 failures** and **15 pending cases without tests**. It is not an
  all-role acceptance pass.
- Independent integration review found no lost parent/auth/Settings changes.
  The native PostgreSQL and PostgREST evidence above belongs to the original
  unchanged history implementation; those runs were not repeated for this
  frontend integration.

This is a separate fork review candidate. S4 event/queue and view-inventory
repairs remain their own branches. The calendar migration/caller and feedback
blockers still prevent treating a green parent branch as a production release.

## Pinned-main refresh — September 18, 2026

`parent/P3-history-current` starts at `a1e5339`, merges canonical main
`00910940f596d9fe9a7cd416dc741943d1df2cc9` (`960a83c`), then merges the retained
coach-history fix `01304a4f26d6c79c7b9be9511463a17ef9382f0e` from #49 (`6febc81`).
Both merges were automatic. Nullable author projections, null-ID filtering,
neutral attribution and genuine name-query failure/retry behavior are retained.
The history migration and all existing SQL suites are byte-identical to the
reviewed history candidate. No new feature or migration SQL was written.

The added opt-in `--parent-history-upgrade-review` mode validates all 62 migration
files against immutable Git blobs at main `0091094`, applies those first while
preserving the known report-before-P1 deployment inversion, checks
that history RPCs are still absent, then applies the pending
`20260918112323_parent_match_history.sql` as migration 63. It rejects changed or
missing main migrations and unexpected additional versions. This is a pinned
canonical-main schema replay; it is not itself proof of the hosted migration
inventory. Existing default and P1/report upgrade modes remain available.

CI now runs five Node tests for this mode with full Git history available. The
tests execute the real in-memory CLI and role suites; temporary copies prove
that a missing history completion report and a deliberate failing history
assertion both produce exit 1. Missing/incomplete reports cannot masquerade as
success. Every temporary fixture is disposable and is removed afterward.

Final review found the first version of the pinned-main helper used filename
order within main. The separate P1 upgrade mode covered reports-before-P1 but
placed the history migration before newer main migrations. A regression first
failed against that helper, then passed after combining both requirements in
one order: all 62 pinned main migrations, reports before P1, then history last.
All five tests passed again, including the actual CLI and both negative controls.
This models the known deployment inversion; it does not reconstruct an
otherwise unrecorded historical application order from the version ledger.

Fresh local results on the refreshed code:

- Source: **372/372**, including **69** focused parent data/family/retained-history
  tests. The six retained-history tests initially failed because their previous
  Home fixture lacked the new summary RPC; only that authenticated, child-checked
  response fixture was added. Original behavior assertions remain intact.
- New CLI/negative-control/CI-registration tests: **5/5**. Actual CI-condition tests: **8/8**.
  MSW/use-case harness: **17/17**. Typecheck and production build pass.
- Lint: **0 errors / 136 warnings**. Existing large build-chunk warning remains.
- Default, P1/report upgrade and new pinned-main upgrade replays each pass with
  **63 migrations**, **81 history assertions** and **282 operational-view
  assertions**. The new mode also requires all **55 P1 assertion results**.
- Use-case gate exits 0 with **2 enforced cases passing**; pending UC-A02 still
  has **3 failures**, and **15 pending cases have no tests**.
- The first browser attempt built successfully but could not bind preview port
  4189 under the sandbox (`EPERM`). The authorized Chromium rerun passed
  **6/6 mobile journeys in 17.5 seconds**, including the 1,001-row history,
  pagination retry and child switching. All backend HTTP remained synthetic.

Commands: `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run lint`,
`npm run uc:check`, `npm run test:db`,
`npm run test:db -- --parent-upgrade-review`,
`npm run test:db -- --parent-history-upgrade-review`, and
`node --test tests/db/parent-history-upgrade.test.mjs`.
Local logs use `/private/tmp/trak-history-current-*.log`; the successful browser
log is `/private/tmp/trak-parent-history-current-browser.log`.

The coordinator's read-only hosted migration-ledger comparison at
**2026-09-18 16:16:38 UTC** found exactly the 62 versions in main `0091094`:
`missing_versions=[]`, `extra_versions=[]`. History `20260918112323` and the
separate academy migration `20260918062345` were absent. This verifies the
version set only, not SQL statements, live schema bytes, table data or historical
application order; it supports the selected upgrade starting point.

The pending migration's version is below main's `20260918133800` high-water mark.
Before production, refresh against then-current main, obtain exact-head CI
upgrade evidence and the independent human migration-order exception required by
PR46; an author's acknowledgement or this local pass is insufficient. #49 must
be delivered or declared as the outstanding dependency. The migration must reach
the backend before the frontend calls its RPCs. Earlier native PostgreSQL and
PostgREST results remain historical evidence for the unchanged SQL, not fresh
hosted or current-refresh runs. No hosted fixtures, real emails, consent-policy
changes, parked P2 work, production deployment or live-role verification occurred.

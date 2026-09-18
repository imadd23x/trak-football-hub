# Parent match history: scope and verification

Status: implemented and locally verified in a separate fork branch based on #39 `e9fbad3`. No production changes and no new PR while the existing review queue is cleared.

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

Commit and push only to `imadd23x/trak-football-hub` on `parent/P3-match-history`. Existing review heads remain unchanged. Human review and explicit production authorization precede any canonical merge or deployment. Deploy the additive migration before the frontend; verify the two read RPCs, Home totals, an older page and Alerts under an authorized synthetic parent in the target environment when approved.

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

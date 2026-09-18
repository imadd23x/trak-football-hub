# Existing queue: combined fork verification

Source candidate: `565e189`, September 18, 2026. Canonical main was independently
checked at `ff9d713`; all of #17 and #30–39 remain unmerged. This record proves
local/fork outcomes only. It is not human approval, a production deployment or
real-child admission approval.

## Composition and conflict resolutions

The existing integration tree already contained the parent invitation/Auth fixes,
multiple-child screens, truthful Settings, academy/departure/linking controls,
restricted operational views, synthetic demo tooling, date helper and assessment
index. This candidate additionally integrates exact reviewed heads #30 `e5c5b41`
and #17 `74d8867`, #35's consumer correction `d357643`, and #39's direct cache-order
assertion `7a157b7`. No new PR is opened by this verification work.

- `PlayerHome` retains `PlayerParentInviteCard` and match deduplication while adding
  Tarek's load-error and event-time handling.
- `Settings` retains plural `ParentConnections`, honest controls/deletion copy and
  logout-error checks. Only the applicable player coach-link guidance is added.
- MSW retains exact bearer-token Auth verification and adds the RPC helper.
- Onboarding retains worldwide nationalities and captured signup identity; Tarek's
  calendar validation composes with the UTC date-only helper.
- S2's retired legacy-script wrappers remain retired. #35's operator guidance is
  retained in both runbook formats; the old seed/check implementations are not restored.
- Parent browser tests retain P6's Settings assertions. The backfilled-alert test
  now checks the cached order before navigation can trigger a refetch.

All 61 migration files and existing database suites are retained. The parent,
academy, operational-view and assessment-index migrations match their reviewed
versions byte-for-byte. No database migration was changed during this integration.

## Verification

[Fork CI passed for source candidate `565e189`](https://github.com/imadd23x/trak-football-hub/actions/runs/35328848551),
including the native concurrent-linking and assessment-query regressions, the new
required player tests and parent browser journeys. All production jobs were skipped.

| Check | Observed result |
| --- | --- |
| Source suite | 310 tests passed. |
| MSW/use-case harness | 17 tests passed. |
| Parent/invitation browser journeys | All four passed against the built app in Chromium, with external backend requests intercepted. |
| Date helper | 39 cases passed in each of UTC, Dubai, Athens and New York. |
| Synthetic demo | All 37 tests passed; no hosted application of the fixtures. |
| Database runner guards | All 12 passed. |
| PGlite default SQL suites | 61 migrations/backfill checks; invitation and all 282 operational-view assertions passed. |
| Native PostgreSQL 17.11 | 61 migrations; invitation, departure, academy, view and account-deletion suites passed. Private socket cluster stopped and removed. |
| Local Supabase security advisor | Exit 0, no issues found, against the disposable cluster only. |
| Typecheck/build/lint | Passed; lint has 0 errors and 136 warnings. |
| Player linking | UC-A08: all seven tests passed. |
| Match history/recovery | Existing UC-A04: three tests passed; UC-X02: five tests passed after adding successful recovery coverage. |

The new recovery test loads 20 matches, fails the next page, verifies the original
20 remain, recovers the same page, then loads the final page. It checks all 41
distinct matches in order and the request offsets `0, 20, 20, 40`. This supplements
the existing test that only verified retrying the failed offset.

The integration CI now explicitly requires the UC-A08 and UC-X02 files and runs
their 12 tests as a failing check. Their broader registry contracts remain pending;
this does not falsely promote untested requirements to enforced status. That CI
addition and the new recovery case are integration commits requiring review and
retention when the queue is applied to canonical main.

## Remaining failures and release limits

- The use-case gate still reports three UC-A02 failures: the registered athlete
  logging journey has no route. The coach-only/product-contract decision remains
  open; no assertion or registry contract was weakened. Two enforced cases pass.
- The explicit consent/privacy audit was rerun against all 61 migrations: eight
  desired denials fail, all 19 controls pass. Private child note access, purpose
  enforcement and withdrawal remain unresolved. It is deliberately red and is
  excluded from claims about passing default security suites.
- Native race and query-plan regressions passed in this fork CI run. Local query
  timings and five overlapping database readers are not hosted capacity evidence.
- Real email/invitation delivery, real phones, deployed synthetic-role checks,
  branch protection, backup restoration, notices/agreements and real-minor
  admission gates remain distinct unfinished work.

A suspected coach-card account-switch race was tested through the real routed
App/AuthProvider/Supabase SDK with a delayed previous-account response. RouteGuard
unmounted the old card, and the new account stayed unlinked after that response
arrived. The static finding was withdrawn; no speculative app patch was made.

Review #35's updated head first because the exposed report permissions remain a
live release concern, then the already-reviewed #30/#17 and remaining dependencies.
Imad coordinates merges after the required human reviews. Each main deployment
must finish and be checked before advancing the schema queue.

# Pending athlete use-case contracts

Status reviewed at integration commit `4c3f35d`, September 18, 2026. This bounded source review explains the three previously recorded UC-A02 failures and one UC-A04 failure; it did not rerun the suite or change app code, tests, or registry contracts.

Update: the [combined fork candidate](queue-integration-2026-09-18.md) `565e189`
integrates #30 and passes UC-A04's three tests plus five UC-X02 tests, including
successful recovery of a failed second page without lost or duplicated matches.
Only the three UC-A02 failures remain in the use-case run. Canonical main has not
received these fixes; the original findings below describe the earlier snapshot.

## UC-A02: missing registered functionality

The [contract](../use-cases/registry.yaml) (lines 8–20) requires a signed-in athlete to save a match with a computed rating, reach its result screen, and see no decimal score. The [tests](../../tests/usecases/athlete/UC-A02.log-match.test.tsx) open `/player/log` at lines 39, 57 and 73.

There is no player logging or result route in [App.tsx](../../src/App.tsx) (lines 98–105); the unknown path reaches the fallback at line 150. Neither screen exists, and [player navigation](../../src/components/trak/NavBar.tsx) (lines 25–31) offers no logging entry. This is the existing [open product-scope question](../use-cases/OPEN-QUESTIONS.md#q-2026-09-08-01--uc-a02-uc-a03--athlete-match-logging-has-no-reachable-entry-point), not merely a stale fixture or mistyped route.

Current logging is coach-driven: the routed [CoachAddSession](../../src/pages/coach/CoachAddSession.tsx) calls `log_match_for_player` at line 261. Repointing the athlete test to that screen would change its actor and contract; do not mark UC-A02 passing on that basis.

Required next step is an explicit product decision:

- If the athlete contract stands, restore reachable logging and result journeys, then supply the actual required player/position and match inputs in the tests. Preserve persistence, exact-result navigation and hidden-score assertions.
- If coach-only logging is intended, revise REQ-001 and UC-A02/A03 through the product-owned versioned registry process. Keep current failures visible until that decision is recorded.
- Test the coach journey separately with a coach identity, linked roster, session/match inputs, player participation, attendance and RPC responses. The existing athlete fixture intercepts a direct `matches` insert and cannot represent that flow.

Coordinate with Kostas K3–K5 for coach logging and Tarek T1 for match identity; this review authorizes no restoration or contract rewrite.

## UC-A04: genuine routed error-state defect

[PlayerMatches.tsx](../../src/pages/player/PlayerMatches.tsx) discards the query error at line 25, substitutes `[]` at line 30, and displays “No matches found” at lines 90–91. The [failed-load test](../../tests/usecases/athlete/UC-A04.match-history.test.tsx) (lines 94–129) correctly detects this violation of [UC-A04](../use-cases/registry.yaml) (lines 38–50).

Tarek owns this through T7. Reviewed [PR #30](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/pull/30), head `e5c5b41`, includes loading/error/retry states and advances pagination only after success. That exact head is now in the fork candidate above and remains unmerged into canonical main.

Required regressions before enforcement:

- Preserve successful populated-history and genuine-empty controls, and the existing failed-load assertion.
- Await a visible retryable error after a failed request; retry successfully and verify the expected cards replace it.
- Use more than one page of distinguishable matches; a failed next-page request must preserve current rows, retry the same range, and neither skip nor duplicate matches.

No test or registry assertion should be weakened to hide either finding. See the [current ownership plan](../pilot-readiness-2026-09-25.md#ownership-and-deliverables).

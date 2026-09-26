# Open Questions for the Product Owner

Entries are appended by `scripts/uc-check.mjs` when a use case fails, drifts,
or is edited without authority. Resolve one by picking an option, doing it,
and changing `Status: OPEN` to `Status: RESOLVED <date>`.

Never resolve a question by weakening the assertion in the test.

---

## Q-2026-09-07-01 · UC-P02, UC-P03, UC-P06 · Parent visibility of the child's goals
Raised: 2026-09-07 · seeded during harness design · REQ-004

IN use case 12 of the 2026-07-27 pilot scope reads "Parent sees child's season
band, match feed and coach assessments". The role inventory in the same
document also lists P4, "See child's goals". These disagree.

The registry currently follows the IN list: **parent goal visibility is not a
use case** and `src/pages/parent/ParentGoals.tsx` is therefore untested and
unenforced, despite the route existing.

PO decision needed — one of:
  [x] IN list stands -> parent goals are out of pilot scope; remove the route
  [ ] Inventory stands -> add UC-P04 to the registry and build it properly
  [ ] Ambiguous -> restate what a parent should see, and the registry follows

Done: `ParentGoals.tsx` and its route are gone from `src/`. Parent goals are
cut in `MVP Requirements`.

Status: RESOLVED 2026-09-23

---

## Q-2026-09-07-02 · UC-C03, UC-A04, UC-X02 · Failed loads render as empty states
Raised: 2026-09-07 · found while writing UC-C03 · REQ-004

Every list screen destructures only `{ data }` from Supabase and falls back to
`[]`, so a permission failure, a network failure and a genuinely empty result
render the same message. Confirmed in `src/pages/coach/CoachSquadPage.tsx:16`
and, identically, in `src/pages/player/PlayerMatches.tsx` (`const { data } =
await supabase...` then `const rows = data || []`); the same pattern is also
in `ParentHome.tsx` and `ParentMatches.tsx`.

UC-C03 and UC-X02 both forbid this; UC-A04's third `then` clause ("A failed
load is distinguishable from an empty history") forbids the same thing for
`PlayerMatches.tsx` and fails on exactly this defect in
`tests/usecases/athlete/UC-A04.match-history.test.tsx`. UC-C03 and UC-A04
therefore both stay `pending`.

PO decision needed — one of:
  [x] Spec stands -> fix the four screens to show a retryable error
  [ ] Spec changes -> bump spec_version and state what a failed load may show

Done: UC-C03, UC-A04 and UC-X02 are `enforced` and pass. A clear error with a
retry button is the pilot contract (`MVP Requirements`, J6); automatic retry
is cut.

Status: RESOLVED 2026-09-23

---

## Q-2026-09-08-01 · UC-A02, UC-A03 · Athlete match logging has no reachable entry point
Raised: 2026-09-08 · found while repairing the use-case harness after merging main · REQ-001

`main` deleted `src/pages/player/PlayerLogForm.tsx` and removed the
`/player/log` route from `src/App.tsx`. Nothing left in `src/` references
either. UC-A02, "Log a match with position inputs and live band preview", is
REQ-001 — the use case the pilot's central hypothesis depends on — and it now
has no screen to exercise. `tests/usecases/athlete/UC-A02.log-match.test.tsx`
fails on all three assertions for exactly this reason and has been left
failing rather than repointed at a different screen or weakened.

`main` also deleted `src/pages/player/PlayerResult.tsx`, the screen UC-A03
("See band result after saving a match") exercises, along with
`PlayerLogForm.tsx`. There is no result screen and no route to reach one.
UC-A02 and UC-A03 are two halves of the same player-driven flow — log, then
see the band — and both halves are now gone from `src/`: neither the logging
step nor the band feedback that follows it has a reachable entry point. No
`tests/usecases/athlete/UC-A03...` test has been written against a screen
that no longer exists, and UC-A03 has not been repointed at another screen;
it stays `pending` in the registry, unbuilt, for the same reason UC-A02 stays
failing rather than being weakened or deleted.

`CLAUDE.md` documents a `log_match_for_player` RPC, and it is in fact called
from `src/pages/coach/CoachAddSession.tsx` and
`src/pages/coach/CoachQuickMatchLog.tsx` — both coach-driven. So match logging
appears to have moved from player-driven to coach-driven, not simply been
dropped. If that move is intentional, it changes the pilot's player-first
thesis and REQ-001 itself, not just these two use cases — REQ-001 depends on
both UC-A02 and UC-A03.

PO decision needed — one of:
  [ ] Spec stands -> restore a player-reachable match-logging screen and route,
      and a result screen for the band feedback that follows it
  [x] Spec changes -> logging is coach-driven now; rewrite REQ-001, UC-A02 and
      UC-A03 (and any other player-first use cases that assume them) to match
  [ ] Ambiguous -> clarify whether the pilot's player-first thesis still holds
      before the registry is changed either way

Done: coach-only match logging was confirmed for the pilot on 20 Sep in
Slack (#coding-agent-reviews). UC-A02/A03 are `parked`. REQ-001 is retired
in `MVP Requirements` (J4 replaces it). The other player-first use cases are
raised in Q-2026-09-23-01.

Status: RESOLVED 2026-09-23

---

## Q-2026-09-23-01 · UC-C02, UC-A08, UC-A10, UC-C07, UC-P01, UC-P07, UC-A06, UC-A07, UC-C08 · Registry vs academy admission
Raised: 2026-09-23 · found while writing MVP Requirements · REQ-003

`MVP Requirements` J1 admits pilot children only through the academy roster
and an invitation. Coaches do not add players, and nobody links by name or
code. The registry still describes the April code-linking flow:

- UC-C02 (coach adds a player manually) is `enforced`, so it blocks commits if
  that screen is removed. The route is `/coach/squad/add`.
- UC-A08, UC-A10, UC-C07 and UC-P01 (TRK-/PAR- codes) are `pending`. UC-A08's
  test passes, and `uc:check` prints "flip them to enforced", which would
  enforce a flow J1 forbids.
- UC-P07 covers consent for ages 13–14. The threshold is now 18.
- UC-A06 (goals), UC-A07 (medals) and UC-C08 (player-logged matches) are
  outside the pilot.

Owner: @kostasanastasioubusiness-lang (registry). Do not weaken a test to settle this.

PO decision needed — one of:
  [x] Spec changes -> park the code-linking, goals and medals cases, rewrite
      UC-C02 and UC-P07 to match J1/J2, and add use cases for J1–J4
  [ ] Spec stands -> keep code linking in the pilot, and change J1 instead

Done (TRAK-19): UC-A06, UC-A07, UC-A08, UC-A10, UC-C07, UC-C08 and UC-P01
are `parked`, and UC-A08's test file is deleted, following the UC-A02/A03
precedent. UC-C02 v2 now says coaches do not add players; it is `pending`
until TRAK-47 removes `/coach/squad/add`, and its new test is red on main
today and green once the route and its buttons are gone. UC-P07 v2 covers
every child under 18. UC-X03, UC-X04, UC-P08, UC-P09, UC-A11, UC-C09 and
UC-C10 are added as `pending` for J1–J4.

Status: RESOLVED 2026-09-23

## Q-2026-09-24-UC-C03 · UC-C03 · View the squad
Raised: 2026-09-24 · commit blocked · REQ-002
Observed: UC-C03: enforced use-case test failed
Spec (v2) says:
  THEN Every player in their squad is listed
  THEN A coach with an empty squad sees an explicit empty message
  THEN A failed load is distinguishable from an empty squad

PO decision needed — one of:
  [ ] Spec stands -> code bug, fix the code, no registry change
  [ ] Spec changes -> bump spec_version, add changelog entry, dev updates test
  [ ] Spec ambiguous -> rewrite given/when/then, bump spec_version
Status: OPEN

Resolution: the UC-C03 specification stands unchanged. TRAK-47 follows the
approved academy-admission decision and removes Add Player, so its explicit
empty-state copy now says "Your squad is being prepared". Updated both the
presence and failed-load absence selectors; retained the response-settle
check and added an explicit error assertion. No registry or lock change.
UC-C02 v2 tests remain unchanged and pending backend proof from TRAK-48.

Status: RESOLVED 2026-09-24

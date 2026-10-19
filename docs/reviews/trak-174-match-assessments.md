<!-- delivery-policy: historical -->
> Historical record. Development and delivery follow the [current canonical delivery policy](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/main/docs/release/merge-gate.md). Process instructions recorded below are superseded; product facts, explicit scope holds and test observations remain evidence.

# TRAK-174 — Exact match assessment links

New coach match saves retain the completed session ID on each player match.
Parent Home and Matches open that session's assessment for the selected child.
The existing assessment reader returns bands only; an unassessed or unavailable
session has an explicit unavailable state. Old rows keep their match-detail
links and explicitly say when no assessment link is available. Linked assessment
views retain a Match details action for the selected child. The parent match
detail read is also constrained to that child, including direct URLs. No association is guessed or backfilled from a date or opponent.

## Save contract

`log_match_for_player` accepts an optional final `p_session_id` UUID. Old callers
may omit it and retain a null association. The database checks the existing
coach, academy, consent, goals and assists rules, plus session ownership, match
type, date and that player's present/late attendance. The old function signature
is replaced, avoiding ambiguous default-argument overloads. Only authenticated
callers have execution permission; role/ownership checks still apply. Clients
cannot insert or update match rows directly.

A readable duplicate refusal and a unique session/player index prevent a second
row for the same association. The foreign key clears the association when a
session is deleted, preserving match facts. Historical null-author assessment
reads and sibling isolation use the existing parent readers.

## Verification and release

Final local CI passes 1,752 source tests and all 20 Chromium journeys, including
the extended match-to-assessment and retained-facts flow at both viewports.
Lint, typecheck, harness, use cases, build, bundle credentials, disposable and
native PostgreSQL checks and migration convergence pass. Nine inherited skips
and 24 pending use cases without tests remain coverage debt.

Regression evidence covers the formerly omitted coach argument and wrong parent
row destinations. Database checks exercise correct linking, wrong coach/date,
training instead of match, absent player, unknown session, consent, player
refusal, duplicates, old callers and retained facts after session deletion.
The suite runs in the default disposable and native PostgreSQL gates.

Browser fixtures exercise parent links to a specific older assessment, legacy
links, sibling switching and a linked record with no assessment at 390 and 768
pixels. Backend replies are synthetic and intercepted. Source types reflect the
new nullable column, foreign key and optional RPC argument.

This branch builds on #296, which builds on #295. The migration ships before
frontend deployment through the normal gate. An older frontend can continue
using the extended function without the optional argument; frontend rollback
keeps the stored associations and schema. Independent human approval and
physical-phone J6 verification remain required. No production write or
historical match backfill is performed during implementation.

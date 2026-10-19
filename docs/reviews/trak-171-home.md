<!-- delivery-policy: historical -->
> Historical record. Development and delivery follow the [current canonical delivery policy](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/main/docs/release/merge-gate.md). Process instructions recorded below are superseded; product facts, explicit scope holds and test observations remain evidence.

# TRAK-171 — Home and calendar follow-ups

## Behavior

Player and parent Home show this week's events without a duplicate Next up
card. Their Sessions/Matches lists retain upcoming events. The parent's Home
calendar opens `/parent/events`, where the selected child's upcoming list,
error/retry state and sibling switch reuse the existing family components.
The parent event page returns to Events.

The coach's Home week includes both planned events and recorded sessions.
Recorded sessions say Logged and open `/coach/sessions/:id`. No start time is
invented. A calendar event converted into a session appears once. Correcting
the session date to another week does not restore its old planned entry;
conversion status is checked for this week's event IDs regardless of the
session date. Either failed read gives Retry. Changing coach or child clears
the previous week before another identity's content can render.

The player bell includes the current coach assessment only when the same
message read used by Home confirms a nonempty published message and a valid
publication timestamp. The alert uses that timestamp, participates in the
existing read/dismiss controls, and opens its published message. It carries
the player ID to exclude a previous account's assessment. A failed read offers
Retry. This is the current assessment, not a full assessment history.

The shared event colors from TRAK-159 are retained: training blue, match green,
other orange and cancelled red. The Home strip uses the shared constants.
The possible other-child unread dot remains undecided.

## Verification

- Regressions fail on the prior behavior: duplicate Home cards, calendar
  destination, missing logged sessions, failed session reads, and missing
  published assessment alert.
- Session tests also cover conversion, a date correction across weeks and a
  late response from another coach.
- Real SDK tests preserve empty/error handling, publication filtering,
  inaccessible content clearing, stale-response guards and sibling isolation.
  Existing readback tests inspect the actual bell in place of the removed card.
- Final source suite: 1,725 passing, nine inherited skips. Lint, typecheck,
  build and bundle credential check pass. The database, native PostgreSQL,
  migration-convergence, harness and use-case gates pass. Twenty-four pending
  use cases still lack tests; they are coverage debt.
- Chromium exercises the production build with intercepted synthetic replies:
  parent calendar via keyboard, siblings and event/back navigation; player
  published assessment and message; coach recorded-session links. Before/after
  screenshots were inspected at the existing 390-pixel mobile viewport.
  The three new journeys require no browser console errors or warnings.

## Release limits

No migration, dependency, CoachSchedule change or production write is included.
Schedule already reads recorded sessions. An independent human approval and
the normal release gate are required. TRAK-171 remains unverified on real
phones; run the updated S15 rehearsal after deployment before marking Done.

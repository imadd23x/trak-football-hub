# PR42 follow-up runtime review — 18 September 2026

Exact head: `46518d79234bfa60c74f54330d8d78ec78f5d9d2`. This reruns the two findings reproduced at `c9d99b8b31d00644d9f72d75ec4fd087a15fbb30` against the newer calendar-caller candidate. Only an opt-in test and this document were added.

```sh
TZ=Asia/Dubai npm exec -- vitest run tests/reviews/player-followup.review.test.tsx
```

**5 desired-behavior failures, 3 positive controls passed** (8 tests, 3.28s). Focused ESLint and TypeScript including this file passed. The red audit is outside the ordinary `src` suite; it is not a release pass.

1. **Home hides required-query failures depending on response order.** With either `player_details` or `coach_calendar_events` failing before a held successful matches response, the final screen has no error or Retry. `PlayerHome.tsx:96` resets the flag set by sibling handlers at lines120/169. Both routes failed independently. Clean successful Home and a sibling failure arriving after matches pass controls. This leaves the new sibling-error handling incomplete.
2. **The unchanged timestamp parser fabricates or truncates input.** Repeated whitespace in `2026-03-01  18:00:00` yields Dubai midnight (`2026-02-28T20:00:00.000Z`). The assertion permits strict rejection or correct 18:00; it refuses guessing. Space- and `T`-separated timestamps with trailing garbage are accepted as 18:00. `event-time.ts:121–123` splits at single separators and takes only five time characters. The space-form acceptance is new relative to merged PR30 `e5c5b41`; the `T` truncation existed before it. Valid single-space, explicit `+04`, and rejected non-time controls pass.

The test uses the real routed App, AuthProvider and Supabase SDK with synthetic MSW HTTP. The updated calendar fixture asserts PR42's actual date/fallback predicate, ordering and limit, and applies date filtering to its new-column event. The real invitation component receives an empty invite list. A transparent observer calls original `Response.text` unchanged and confirms the SDK consumed the sibling error before matches is released. Unknown HTTP requests are blocked and asserted absent.

No app/schema changes, hosted requests, real accounts, email or provider calls occurred. This does not validate SQL/RLS or PR41 migration compatibility. Calendar deployment order and the caller date/time convention require their separate review. Fix Home error aggregation and complete timestamp validation, then rerun this same explicit audit.

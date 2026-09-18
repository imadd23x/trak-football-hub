# PR42 calendar caller review — 18 September 2026

Reviewed exact head `d0de05760bbba008139f2a72426c62b8a3d20583`. The original four runtime regressions pass. Two additional desired-behavior tests fail: the player Upcoming list includes clearly ended sessions, and the fallback for rows without a calendar date can hide an imminent event behind later sessions.

This is a local synthetic HTTP/runtime review, not evidence of a deployed schema, real academy data, or live credentials. No application source, migration, or remote data was changed. The opt-in audit is [calendar-runtime.review.test.tsx](../../tests/reviews/calendar-runtime.review.test.tsx); it intentionally remains red until these behaviors are repaired and is outside the normal `npm test` source-only selection.

## Remaining findings

### P2 — Ended sessions crowd future sessions out of Upcoming

[PlayerHome.tsx:162–165](../../src/pages/player/PlayerHome.tsx) includes every event whose `event_date` is today, orders them before tomorrow, and applies a five-row limit. At noon Dubai on 18 September, the fixture contains an untimed event today, five sessions ending between 06:30 and 10:30 today, and a timed session tomorrow. The actual player route displays the TBC event and four ended sessions under **UPCOMING**, while tomorrow's event is absent. These sessions have explicit `ends_at` values before the test clock; this does not depend on deciding whether an ongoing session is upcoming.

Runtime assertion: audit lines 270–289. Preserve today's untimed events, but exclude clearly ended timed sessions before the result limit. Changing only the card label or filtering the already-limited array would still hide future sessions.

### P2 — Nullable calendar dates sort after every dated future event

[PlayerHome.tsx:162–165](../../src/pages/player/PlayerHome.tsx) deliberately includes a future `starts_at` when `event_date` is null, but then orders `event_date ASC NULLS LAST` before applying the five-row limit. An event at 18:00 today with nullable calendar fields disappears when five dated events exist on 20–24 September. A single-row control proves the fallback itself renders the date and local time correctly; its position in the limited list is the failure.

Runtime assertion: audit lines 254–268; positive control lines 246–252. Such rows remain within the explicit compatibility contract: [displayEventTime](../../src/lib/event-time.ts) lines 181–185 supports rows from older clients, and the generated schema fields are nullable. The new importer no longer creates them at this head, so this finding is specifically about retained compatibility and older writers, not an unfixed current importer. Use one effective chronological order for both shapes before limiting, or enforce a complete non-null data/writer contract before dropping the fallback.

## Writers and release dependency

- Manual save writes the calendar day/time alongside the instant: `CoachSchedule.tsx` lines 202–228.
- The initial reviewed head `46518d7` omitted these fields from single and bulk imports. At current `d0de057`, both now call `calendarFieldsFromInstant`: lines 292–302 and 335–343. That gap is corrected in source; this seven-test audit does not exercise save requests.
- `calendarFieldsFromInstant`, `event-time.ts` lines 190–214, explicitly retains the parser's midnight ambiguity. A true midnight kickoff and an unknown time cannot be distinguished from the timestamp alone. Parser-contract verification is separate from this review.
- This exact PR42 tree has no migration adding `event_date`/`start_time`; the helper references PR41 migration `20260918000001`. Deploy the reviewed schema/backfill dependency before the new frontend. A null-value fallback cannot handle a missing SQL column: PlayerHome filters/orders that column, and manual/import saves write it. No hosted schema verification was performed here.

## Verification evidence

Clock fixed at `2026-09-18T08:00:00.000Z` (12:00 Dubai), with only `Date` mocked; React and network timers remain real. Real App/router, AuthProvider and Supabase SDK run against explicit synthetic MSW endpoints. The calendar handler applies the actual nested AND/OR predicate, null ordering and result limit before returning selected columns; unknown query shapes and all unexpected HTTP calls fail. The model follows [PostgREST filtering, ordering and limits](https://docs.postgrest.org/en/stable/references/api/tables_views.html). It is not a database or PostgREST process test.

```sh
TZ=Asia/Dubai DEBUG_PRINT_LIMIT=0 npm exec -- vitest run tests/reviews/calendar-runtime.review.test.tsx --reporter=verbose
npm exec -- eslint tests/reviews/calendar-runtime.review.test.tsx
npm run typecheck
git diff --check
```

At `d0de057`, 17:05 Dubai: **5 passed, 2 failed, 7 total**, exit 1. The original four pass (future timed control, authoritative legacy coach day, legacy player wall-clock time, today's TBC event), as does the nullable-row fallback control. Both findings above fail on rendered UI after a returned sibling has rendered, preventing a loading-state false positive. All requests were accounted for. Only React Router future-version warnings appeared. The same seven tests also produced 5/2 at `46518d7` at 17:02 Dubai; the importer update does not change the player query.

Focused ESLint, application typecheck, and whitespace checks pass. Application typecheck selects `src`; the review test is executed by Vitest and checked by ESLint, not included in that TypeScript project. No Chromium, hosted API, parser AI, migration replay, deployment, or new old-code baseline run was performed for this bounded review.

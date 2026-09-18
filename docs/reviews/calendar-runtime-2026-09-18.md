# Calendar consumer runtime audit

Reviewed **18 September 2026**, base `cae7471b5d5b6487eefc21dd8cc4afa3efb37561`
(release guard repair including canonical `b9adf1c`). No application or schema
changes are included in this audit.

Run explicitly; these desired-behavior failures are outside the normal `src`
test gate:

```sh
TZ=Asia/Dubai npm exec -- vitest run tests/reviews/calendar-runtime.review.test.tsx
```

Result: **3 failed, 1 passed**, 3.16 seconds. The valid timed-event control
passes; all three failures reproduce calendar behavior rather than setup or
unexpected-network errors. Explicit TypeScript checking including this
outside-`src` test file passes. Focused ESLint and whitespace checks pass.

| Case | Observed result |
| --- | --- |
| Valid future event: `starts_at=2026-09-19T14:00:00Z`, wall clock `18:00` | **PASS:** real player Home displays 19 September at 18:00 Dubai. |
| Legacy coach event: `starts_at=2026-09-18T21:00:00Z`, `event_date=2026-09-18`, `start_time=21:00:00` | **FAIL:** absent from selected 18 September even though the HTTP response includes it. A same-day timed control renders correctly. Source converts the legacy instant to local 19 September 01:00 instead of using the supplied date. |
| Legacy player event: `starts_at=2026-09-19T18:00:00Z`, `start_time=18:00:00` | **FAIL:** the rendered card says **22:00**, ignoring its supplied wall-clock time. |
| Untimed event for 18 September: local-midnight placeholder `2026-09-17T20:00:00Z`, `event_date=2026-09-18`, `start_time=NULL` | **FAIL:** at noon Dubai, the player query excludes it; a later-today control renders. The desired event/TBC assertion fails on the missing event first. |

## Execution and boundaries

- Tests render the actual `App`, router, `AuthProvider`, `RouteGuard`,
  `CoachSchedule` and `PlayerHome`, using the installed Supabase SDK. Auth
  responses and JWT-shaped credentials are synthetic; no `useAuth` mock or
  development route bypass is used.
- The process timezone is required to be `Asia/Dubai`; the test asserts it.
  Only `Date` is faked to `2026-09-18T08:00:00Z`. Network, React and test-wait
  timers remain real. The clock is restored after each case.
- MSW projects requested fields and applies the actual calendar query's
  filters/order/limit. In particular, it does not return an untimed row that
  `starts_at >= now` would exclude. Unknown HTTP/query shapes fail explicitly;
  telemetry and read-only consent/invite RPCs have synthetic responses.
- HTTP fixtures include PR41's reviewed `event_date`, `start_time`, `end_time`
  fields. **PR41's migration is not present or applied here.** This demonstrates
  that adding those fields alone does not change these consumers.
- This is component/runtime evidence, not a real browser/phone, PostgREST/RLS,
  provider, hosted deployment, or migration/backfill verification. No real
  accounts, emails, provider calls or database writes are used. If the repair
  changes the query contract, extend the explicit HTTP fixture accordingly;
  an unmodelled predicate is not evidence of an application defect.

## Source cause and next verification

`CoachSchedule.tsx:146–147` derives calendar parts from `starts_at`;
`PlayerHome.tsx:150` filters upcoming events by the placeholder instant, and
`:502–506` formats that instant. These source explanations agree with the
observed failures. The coach event appearing on **19 September** is a source
inference; the test observes its absence on 18 September, not a second-day click.

Keep the assertions red until readers consume authoritative date/time fields
and upcoming-event selection retains same-day untimed events. Writer/parser
changes, historical backfill classification, migration order, cached old
clients and Athens/Dubai cross-zone verification remain separate release work.

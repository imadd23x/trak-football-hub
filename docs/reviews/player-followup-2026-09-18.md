# Player follow-up runtime review — 18 September 2026

Reviewed exact commit `c9d99b8b31d00644d9f72d75ec4fd087a15fbb30`, compared with merged PR30 head `e5c5b41`. Only this evidence document and an opt-in test were added; no application, schema, hosted data, or provider changes.

## Reproduction

```sh
TZ=Asia/Dubai npm exec -- vitest run tests/reviews/player-followup.review.test.tsx
```

Result: **5 desired-behavior failures, 3 positive controls passed** (8 tests, 3.19s). These failures deliberately remain red. The file is outside the ordinary `src` test suite. Focused ESLint and TypeScript checking including this file passed.

## Observed failures

- **A successful matches response erases an earlier sibling failure.** The real routed `App`/`AuthProvider`/Supabase SDK received a failed `player_details` request, or separately a failed `coach_calendar_events` request, before a held successful matches response. After releasing matches, Home rendered without its error or Retry control. `PlayerHome.tsx:123` clears the shared flag set at lines147/189. This is an incomplete new sibling-error fix; the former version silently ignored those errors altogether. Clean successful Home and failure arriving *after* matches both pass controls.
- **Repeated whitespace guesses midnight.** `normalizeInstant('2026-03-01  18:00:00')` returned `2026-02-28T20:00:00.000Z` (Dubai midnight), not the supplied 18:00. The assertion accepts either strict rejection (`null`) or correctly preserving 18:00; it does not require permissive whitespace parsing.
- **Trailing junk is discarded.** Both `2026-03-01 18:00:00 garbage` and `2026-03-01T18:00:00garbage` returned 18:00 instead of `null`. The space form is newly accepted by the changed separator; truncation after the `T` form already existed at `e5c5b41`. `event-time.ts:121–123` splits on a single separator and truncates the time to five characters. Valid single-space input, explicit `+04`, and rejected non-time input pass controls.

## Boundaries and repair contract

The HTTP fixture is entirely synthetic, blocks unknown requests, and uses actual SDK response parsing. A transparent `Response.text` observer confirms that the error response was consumed before releasing matches; it calls the original method unchanged. No auth context, page, SDK query, or parser is replaced. The test does not verify live Auth, SQL/RLS, email, provider behavior, or browser layout.

Keep failures from any required Home query visible until a successful retry resolves them; success of one independent request must not clear another request's error. Parse complete timestamp input or reject it, without fabricating a time or discarding trailing content. Calendar column integration and the existing untimed-event convention are separate from these reproductions.

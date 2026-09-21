# Full assessment form: player and account isolation

Reviewed #44 at `a9211cb`. The current form could send an UPDATE targeting
Alex's existing assessment with Bella's `squad_player_id` when the coach changed
the selector and saved before Bella's lookup completed. The rendered regression
captured this request through the real Supabase SDK and synthetic HTTP handlers.
No production data was accessed or modified.

Related reproduced failures: Alex's late shared-feedback response populated
Bella's form; scores and a private draft survived a player change; a failed
shared-feedback read looked empty; refreshing the same account overwrote edits;
a private-note write failure navigated away; existing private notes could not be
loaded/cleared; a different coach retained the previous roster selection.

## Acceptance and implementation

- Bind loading, editing and saving to one account/player. Clear player-specific
  state on selection changes and ignore/cancel stale reads.
- Wait for successful assessment, private-note, shared-feedback and choice
  loading before accepting edits or saves. Show a retryable load failure.
- Remount the form when the account ID changes; preserve the form when only the
  same account's user object refreshes.
- Restrict assessment updates by assessment ID, coach ID and player ID together.
- Disable editing/selection while saving, suppress obsolete save continuations,
  and keep partial-save failures on the form. Once an assessment is saved,
  retries update its ID instead of inserting another assessment.
- Load and clear private notes independently of published feedback. Never copy
  one text field into the other.

## Executed evidence

`src/__tests__/coach-assessment-isolation.test.tsx` renders the actual page with
React Router and the real Supabase SDK. Only auth context and telemetry are
stubbed; MSW supplies synthetic responses and records outgoing writes. Every
test unmounts its own component and releases outstanding response gates.

All **8 tests failed** against #44's original component, then **8 passed** with
this fix. The delayed-response case also saves Bella successfully after Alex's
response completes, proving that the fix does not merely disable all writes.
The partial-note case verifies one INSERT followed by an UPDATE of that same
assessment, with the private text retained for retry.

Commands and outcomes:

- `npx vitest run src/__tests__/coach-assessment-isolation.test.tsx src/__tests__/coach-shared-feedback.test.ts src/__tests__/coach-silent-writes.test.ts`: 48 passed.
- `npm test`: 453 passed, 9 skipped.
- `npm run test:harness`: 17 passed.
- `npm run typecheck`, `npm run build`, `npm run check:bundle`: passed.
- `npm run lint`: zero errors; existing warnings remain.
- `npm run uc:check`: enforced cases pass, but three pending UC-A02 assertions
  still fail and 15 pending cases have no tests. Those remain pilot work.

## Integration and limits

This is a source-only correction based on #44. It changes no database schema,
policies, migration files or environment settings. Kostas can incorporate the
commit into #44 and obtain review of the resulting head. The #68 → #44 migration
ordering and separate collision fix still apply.

The tests establish client request/state isolation, not production RLS, email
delivery or phone usability. Cancelling an HTTP request cannot roll back a
write already accepted by the server; ambiguous transport failure after the
initial assessment INSERT is not an exactly-once guarantee. No production
deployment has occurred. Revert this source commit before release if necessary;
there is no schema rollback.

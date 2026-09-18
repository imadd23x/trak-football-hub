# K9 publication runtime review

Reviewed canonical PR44 at `2034f5ff384c41a8d620623042b4615b41c180c8`.
This fork branch adds review evidence and regression reproductions only; it does
not change the teammate's application or migration. No hosted data was used.

## Verified improvement

The existing SQL harness passes with all 63 migrations, including the new
coach-note privacy suite and 282 reporting-view assertions. Independently running
the pinned consent audit against this exact candidate makes
`CP1.child-private-note-denied` pass. The other seven named consent failures
remain; all 19 controls pass. Its only ratchet violation is the required reduction
of accepted CP1 debt. Do not change the main baseline until the fix is integrated
and independently reviewed.

## Findings

1. **Published feedback has no player consumer.** The new coach form writes
   `coach_shared_feedback`, but no player route in this head queries that table.
   PlayerHome still queries `coach_assessment_notes` at lines137–140, and
   PlayerFeedback's local path and edge function still use private notes. Restoring
   privacy is correct, but the new shared text is not displayed by the app. T2
   at `6921ed9` reads its separate `player_feedback` table, so that pending branch
   does not supply this consumer either. Connect the deliberate publication to
   the player route and verify draft/publish/retract end to end; do not restore
   private-note reads.

2. **A failed publication loses the coach's edit context.** At CoachAssessPage
   lines245–261, a failed shared-feedback upsert shows an error but still navigates
   home, leaving `saving` true. The runtime regression submits explicit shared
   text, receives synthetic HTTP403/42501 for that write, observes the error,
   then observes navigation to `/coach/home`. Keep the form, preserve the saved
   assessment ID, reset saving, and allow a retry without a second assessment.

3. **A zero-row assessment update is treated as completion.** The preexisting
   save check at lines213–218 tests `error` only. A successful HTTP response with
   an empty row array means `saved` is null: no shared feedback is written and
   the form still navigates home. The runtime regression exercises the actual
   SDK's `.maybeSingle()` path and gets no error message. Require an actual saved
   row before continuing. This is an adjacent existing failure, not introduced
   by the new shared-feedback write.

## Reproduce

```sh
npm ci --legacy-peer-deps
npx vitest run tests/reviews/K9-publish-review.test.tsx
npm run test:db
```

Runtime result on the reviewed candidate: **one positive control passes, two
regressions fail** (1.34 seconds). The passing control proves that deliberate
shared text and publication state reach the actual Supabase SDK request and the
successful flow can finish. HTTP is synthetic; Auth identity, navigation and
toasts are controlled to inspect component behavior. No SQL authorization claim
is inferred from these frontend tests. The separate disposable SQL suites cover
actual authenticated roles.

The new review tests intentionally assert the required corrected behavior.
They must stay red until the corresponding application fix is present. They are
under `tests/reviews`, outside the existing `npm test` source-only command; a
separate green source CI run must not be described as these reproductions passing.

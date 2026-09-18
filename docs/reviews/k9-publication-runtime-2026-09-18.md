# K9 publication runtime review

## Current rereview: 89cd973

Kostas updated PR44 to `89cd973b773766840485efdcdfca1c037819f1ee`.
The previous two save regressions now pass through the actual component and SDK:
failed publication keeps the form/text, and a successful retry updates the saved
assessment instead of inserting a duplicate; a zero-row assessment save reports
failure and stays on the form. The successful-publication control also passes.

PlayerHome now queries published `coach_shared_feedback`, and the new reader
controls verify both rendering published text and hiding an unpublished row on
a fresh mount. One remaining regression is reproducible: after showing published
text, a same-account Auth refresh reruns the effect and receives no shared row,
but the old text stays visible. `PlayerHome.tsx:153` only sets state for a truthy
body. A retraction or failed read must clear the previous value, and stale request
completion must not restore it. This is a state-replacement problem, not a claim
that the backend returns unpublished text or that the app polls for retractions.

Run both evidence suites:

```sh
npx vitest run tests/reviews/K9-publish-review.test.tsx tests/reviews/K9-reader-review.test.tsx
```

Current result: **5 pass, 1 failure**, 1.40 seconds. The sole failure is the
retraction reread above. The old exact toast wording was relaxed to require the
actual refusal message; the retry test now additionally counts one assessment
insert and one update. Reader tests assert the actual request's assessment and
publication filters and wait for the completed second load. These are synthetic
HTTP fixtures with real components/SDK, not hosted or new SQL verification.

The migrations are unchanged from the earlier reviewed head, so its SQL evidence
below remains historical context rather than a newly rerun check. PlayerHome's
feedback link still leads to PlayerFeedback, whose legacy consumer is unchanged;
coordinate the final detail-route contract with T2's separate `player_feedback`
reader. No formal approval or production action is implied by this rereview.

## Original review: 2034f5f

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

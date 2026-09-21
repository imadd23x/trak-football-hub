# Rehearsal seed completion — 21 September 2026

Baseline: `910a7e0`, including #92's latest-note backfill. This change repairs the synthetic rehearsal CLI; it does not change consent policy, migrations, application authorization or the purge path.

## Reproduced failures

The actual baseline CLI module was executed in a VM with a stateful synthetic Supabase client. Imports, filesystem access from the CLI and external network access are unavailable. The fixture models Auth identities, player-only match reads, guardian links, consent-gated assessment/award writes, and durable rows across reruns.

- Fresh threshold-18 rehearsal: **60 consent denials, zero assessments**, but the CLI printed `Done` and exited **0**. Guardian consent ran after development records. Matches are not consent-gated by the current RPC; the fixture does not invent that gate.
- Persistent signup throttling: one intended player remained absent, leaving **14 player accounts**, but the CLI printed `Done` and exited **0**.
- Baseline output contained the configured synthetic password.
- The initial regression suite reproduced missing-player history staying absent when another player already had an assessment, failed roster reads treated as empty data, and no bounded retry for transient signup throttling.
- During implementation, admitting a legacy linked row shifted the other players' fixture sampling: **87 matches instead of 80**. A failing regression established this before fixture selection was tied to stable canonical roster positions.

Independent review added two executable negative controls against the first implementation: a canonical `coach_shared_feedback` draft with `published_at = null` still produced `Done`/exit 0, and a private note on an unrelated same-coach roster row was copied into shared feedback. Both new regressions failed before their focused repairs.

## Resulting behavior

Required Auth, profile, roster, invitation, consent, history and feedback failures stop the seed and produce exit **1**, a diagnostic and the last confirmed progress. Successful earlier writes remain; rerunning resumes them. Auth throttling/server errors retry at most four times with bounded delays. Passwords are absent from normal output and redacted from failure diagnostics.

Synthetic guardians are linked and consent is checked before assessment/award writes. The existing notice, wording and three granted purposes are unchanged. A standing consent missing any required rehearsal purpose fails explicitly without overwriting the guardian's choices. Effective consent is verified through `my_consent_status` while authenticated as that player; raw consent helper RPCs are not called.

Canonical roster identities are verified individually. Unrelated rows remain untouched; duplicate intended identities stop the run. Existing linked canonical players remain linked even if the original fixture intended their slot to remain unclaimed. Their signed-in synthetic account must match the roster UUID before any guardian invitation or consent is issued.

Fixture titles, opponents and event types identify the historical series. All identified dates must yield one consistent UTC anchor; ambiguous histories stop rather than selecting an arbitrary date. Required missing records are reconciled per fixture/player, and existing matches are read as their player before switching back to the coach. Latest-note and published-feedback backfill from #92 is retained and verified against each linked canonical player's latest assessment. Publication is restricted to assessment IDs owned by the current coach and attached to the canonical roster. Unrelated private notes and drafts remain untouched. An existing canonical draft stops the seed without changing its content; final completion requires non-null `published_at` on every required latest feedback row.

## Local verification

- Final source suite after both independent-review repairs: **686 passed, 9 skipped**, across **56 passing files and one skipped file**.
- The new suite executes **16 actual-CLI scenarios**: fresh threshold-18 seed; partial player history; failure between match and assessment writes; unrelated rows; duplicate intended identity; legacy linked slot; limited consent; ambiguous fixtures; successful insert with missing returned row; secret-bearing error redaction; #92 backfill; persistent signup throttling; recovered signup throttling; failed roster reads; preservation/rejection of canonical unpublished drafts; preservation of unrelated private notes and drafts.
- Reruns advance the test clock by two days. Recovery scenarios assert successful exit status as well as unchanged persisted counts on the following run.
- Current focused result: **16 runtime scenarios and two existing consent wording/version mirror checks pass**.
- Full lint, typecheck, `node --check seed-pilot-rehearsal.mjs` and `git diff --check` pass on the final source.
- All 20 executable checks from the current `ci.yml` pass after both review repairs, including native PostgreSQL, migration histories/convergence, query plans, bundle budget and 10 browser cases. Results: `/private/tmp/trak-pilot-evidence-20260921/seed-reviewed-final/results.json`.
- Independent re-review executed the draft and unrelated-note cases and confirmed both findings resolved. This does not replace the required non-author human verdict.

Run the focused checks with:

```sh
npx vitest run src/lib/__tests__/rehearsal-seed.test.ts src/lib/__tests__/seed-consent-mirror.test.ts
```

The fixture runner also accepts a third argument naming an extracted historical seed file for negative controls. Its default always runs the working tree's actual CLI; tests do not rewrite or mirror the seed loop.

## Live completion remains separate

Read-only reconciliation reported 26 of the 30 canonical rows, seven unrelated rows, and one additional canonical player already linked in a formerly unclaimed slot. Completing the missing required identities while preserving those records is expected to yield **37 total roster rows and 16 linked canonical players**, rather than forcing the database to exactly 30 rows/15 links. The required fixture count remains 30; extras and actual linked families are reported separately.

The reported historical canonical fixtures identify a September 1 anchor. Later manual assessments must retain their identities/dates and remain the latest where applicable. Existing unrelated calendar records do not define a new seed anchor.

No production seed or Auth mutation was performed for this change. **Explicit live authorization is required before running this script against the shared project.** After an authorized run, verify the counts, each linked player's effective consent and latest published feedback with actual authenticated roles, then execute the routed journeys. The synthetic backend tests do not prove hosted Supabase policy behavior, real Auth throttling/email delivery, browser journeys, performance under load or concurrent seed-process safety. Full current CI and independent review remain release requirements.

## PR #97 review follow-up

Tarek's [review](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/pull/97#issuecomment-5765881244)
required his test-only commit `b64fbaceca068f51d3e96f4b22232b9530d9c7e4`.
It was cherry-picked with provenance as `eda549f`. The fixture places an account
outside the rehearsal domain on an intended roster slot; that account must
receive zero consents, matches and assessments and the seed must stop.

Independent mutation removed the actual CLI's ownership guard. The new test
failed with exactly one match written into the foreign account, while consent
and assessment counts stayed zero. The CLI was restored byte-for-byte and the
test passed. Focused verification now covers 17 actual-CLI scenarios plus the
two existing consent mirror checks. This follow-up does not change production
seed behavior.

The reported one-off throttling-retry failure was not reproduced in 100 fresh
fixture processes or 20 complete test-file runs (two runs concurrently: 340
scenario executions). A temporary instrumented fixture traced the target
account as absent, signup 429, signup 429, created on attempt three, then reused
on every later login. The only retry delays were 1500 and 3000 milliseconds,
executed by the fixture's fake timer. Trace and repeat results are in
`/private/tmp/trak-seed-auth-trace.json`,
`/private/tmp/trak-seed-retry-repeat.json`, and
`/private/tmp/trak-seed-fullfile-repeat.json`.

No cause is established for the reviewer's original flake, so this is not a
claim that it was fixed. The retry assertion now includes the fixture's already
redacted CLI log on failure so a recurrence identifies the failed operation.
No production retry changes or arbitrary timeout increases were made.

All 20 current CI checks pass on the follow-up tree, including 687 source tests
(nine skipped), native PostgreSQL and 10 browser cases. Results:
`/private/tmp/trak-pilot-evidence-20260921/seed-review-followup/results.json`.
Neither the repeat runs nor these CI results establish hosted Auth or seed behavior.

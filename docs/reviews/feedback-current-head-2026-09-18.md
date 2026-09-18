# PR40 current-head regression review — September 18, 2026

**Not ready to merge.** Reviewed Tarek's PR40 at
`8a6a58c2bc1139a9950ee01f2de1312e54492d7c`, based on canonical main
`09d22d408b6633f1ca06d845853adfdca843a463`. This fork branch adds executable
review tests and one opt-in database runner mode. It changes no application,
Edge Function, migration or production configuration. Implementation remains
with Tarek; no replacement PR has been opened.

## Reproduce

Run from this repository with its installed dependencies:

```sh
# Desired behavior audits: currently exit nonzero. Do not treat as release passes.
node node_modules/vitest/vitest.mjs run tests/reviews
node scripts/test-db.mjs --feedback-storage-review

# Tarek's new opt-in tests, unchanged here:
node scripts/test-db.mjs --feedback-publication-review
node scripts/test-db.mjs --roster-adoption-review

# Existing baseline checks:
node node_modules/vitest/vitest.mjs run src tests/msw tests/support
node scripts/test-db.mjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
node node_modules/vite/bin/vite.js build
node node_modules/eslint/bin/eslint.js tests/reviews scripts/test-db.mjs
```

| Check at this head | Result |
| --- | --- |
| Routed UI audit | 6 desired-behavior failures; 2 controls pass |
| Actual Edge handler with substituted transports | 4 malformed-payload failures; 3 controls pass |
| Stronger storage audit, 59 migrations | FS7 fails: 1/48 desired assertions; all 33 controls pass |
| New feedback-publication SQL suite | 16 pass, but negative controls reveal gaps below |
| New roster-adoption SQL suite | 3/6 desired assertions fail |
| Existing source and test-harness suites | 182 tests pass |
| Existing operational-view SQL suite | 282 assertions pass; 59 migrations replay |
| App TypeScript and production build | Pass; existing large-chunk build warning remains |

The SQL runner constructs an in-memory PGlite 0.5.8 / PostgreSQL 18.3 database.
It never uses a hosted connection. UI tests run actual App, Router, AuthProvider,
RouteGuard and Supabase SDK code against synthetic MSW HTTP responses and reject
unexpected requests. They are DOM integration tests, not deployed-browser tests.
The Edge tests execute the checked-in handler after TypeScript transpilation;
only serving/configuration, database transport and provider HTTP are substituted.
No external provider, hosted database, email or real account was used.

## Runtime findings

1. **Reopening an edit drops the publication's draft/assessment association.**
   `src/pages/coach/CoachReviewFeedback.tsx:83` reads only text/time and never
   restores `draftId`. The captured update sends `p_draft_id: null`. The real SQL
   RPC derives assessment identity from the draft, so a replacement loses the
   assessment association used by the player reader. Preserve that identity
   when reopening and editing. The test proves the outgoing payload; the SQL
   consequence follows from the checked-in RPC, not a live publication.

2. **Changing assessments can send the previous player's feedback to the new
   player.** The loading effect at `CoachReviewFeedback.tsx:54` does not clear
   draft/publication state when the next assessment has no publication. A real
   router transition from A to B updates the displayed name and target roster
   but retains A's text. Clicking “Send update” captures a request targeting B
   with A's text and a null draft ID. Scope editor state to the assessment and
   clear it before loading; disable publication until matching data is ready.
   This is an outgoing-request reproduction, not a claim about hosted data.

3. **Late generation for A appears in B's editor.** Generation writes state at
   `CoachReviewFeedback.tsx:126` without checking the current assessment. A held
   A response released after navigation to B fills B's editor with A's text.
   The SQL draft/roster check should reject publishing a nonnull A draft to B;
   the incorrect editor content is independently reproduced. Ignore stale
   responses and bind generation status, draft and publication to their owner.

4. **Malformed feedback crashes both coach and player screens.** Stored coach,
   freshly generated coach and stored player payloads containing `points:[null]`
   each reach the global “Something went wrong” boundary. Rendering dereferences
   unvalidated values in `CoachReviewFeedback.tsx:230` and
   `src/pages/player/PlayerFeedback.tsx:208`. Validate the full response/stored
   payload and provide a recoverable local state. JSON parse success is
   insufficient.

5. **The Edge Function persists unusable model output and returns success.**
   `supabase/functions/player-feedback/index.ts:174` validates only a nonempty
   `points` array. Four isolated executions of the actual handler accept a null
   point, missing point fields, an object-valued title, or object-valued
   encouragement. Each writes a draft and returns HTTP 200. Reject malformed
   output before persistence, using the same structured contract as consumers.

6. **FS7: a coach can erase a published draft's provenance.** The stronger SQL
   suite reproduces successful deletion of a referenced draft. `ON DELETE SET
   NULL` removes the publication's draft identity and its generated/model/source
   history. Preserve referenced provenance with an enforcing FK or equivalent
   concurrency-safe restriction, while preserving intended account/roster
   deletion behavior. This audit accepts only expected permission/RLS denial or
   SQLSTATE 23503 for exactly `player_feedback_draft_id_fkey`; arbitrary errors
   do not count as protection.

Passing UI controls establish that fresh generation preserves its draft ID and
that an actual SDK account switch unmounts the old review through RouteGuard,
preventing the tested late-response account leak. The reproduced state bug is
assessment navigation; do not report it as a demonstrated account-switch leak.
Passing Edge controls cover valid saved output, player refusal before provider
or persistence, and a save failure returning HTTP 500 instead of success.

## Earlier native finding still outstanding

FS8 was reproduced on PostgreSQL 17.11 in the previous
[storage review](https://github.com/imadd23x/trak-football-hub/blob/bfc1bcd9d02755a538bf2e5a0c8112ab81a7f62f/docs/reviews/feedback-storage-2026-09-18.md):
the real academy-admin `remove_coach_from_org` transaction holds a roster lock;
a publisher checks the old ownership state, waits for the lock, then still
publishes after removal commits. Acquire the roster lock before evaluating
authority/consent and recheck after the wait.

This current-head pass did **not** rerun that native race. The migration is
byte-identical to the tested revision, including checks before the lock at
lines 206–228. Its SHA-256 remains
`a84622825b9a3a5a16f3fbf67ec99dab2abdb6a7162d1843037ee31e08c3e654`.
Keep FS8 open until a repaired candidate passes the native regression.

## Why the new passing SQL suite is not sufficient

Disposable mutations were used to test the strength of the tests, not to change
the actual implementation or claim these widened permissions are present:

- Restoring direct publication INSERT plus authenticated draft SELECT
  `USING(true)` still leaves all 16 feedback assertions passing. The direct
  INSERT fixture already has a current publication, so it hits uniqueness
  SQLSTATE 23505 instead of testing authorization. No valid draft is successfully
  inserted anywhere, so draft-isolation reads inspect an empty table. Use a fresh
  unpublished roster row and a populated, valid draft for these checks.
- `supabase/tests/feedback_publication.sql:49` treats every exception other than
  its own sentinel as a successful denial. A nonexistent-column error, 42703,
  counts as passing. Accept only the expected permission/business error and
  verify preserved data; fail on unrelated fixture/schema errors.
- `supabase/tests/roster_adoption.sql:34` changes JWT claims without changing the
  SQL role. With authenticated assessment reads deliberately denied, the three
  happy-path checks still see two assessments as the owner, while an actual
  authenticated player sees zero. Pair JWT identity with `SET ROLE` for reads.

These test mutations were temporary and are not present in this branch. The
findings describe false-positive coverage, not production exploit claims.

## Remaining release boundaries

The route `/coach/feedback/:assessmentId` is registered in `src/App.tsx:113` and
works when opened directly. Source inspection found no coach UI link into it;
the remaining navigation issue is discoverability, not a missing route.

Parent P4 still depends on accepted feedback storage and the academy-specific
effective-consent/read contract. This review does not add parent publication
access, resolve AI use of private notes, or declare consent complete. The
separately parked consent-test conversion remains untouched.

`npm test` runs `src` only, and current CI invokes only the operational-view SQL
mode. The opt-in failures above are not covered by green ordinary CI. After the
implementation is repaired, require these regressions in release checks; do
not invert assertions, suppress failures or count the known failing exit code
as release success. Re-review the final commit before merge.

No production rollout is performed by this review branch. Removing its test and
documentation commit is the complete rollback; it contains no runtime changes.

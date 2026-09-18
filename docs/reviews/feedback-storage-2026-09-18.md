# PR40 feedback storage review — September 18, 2026

**Not ready to merge.** PR40 update `60a3ab7884554c5125a145c65e92d7b40987d843`
fixes the six original findings below. Two additional runtime regressions remain:
publication after concurrent coach removal, and deletion of published draft
provenance. This branch contains Tarek's unchanged revisions plus executable
review tests; it does not contain an independently authored storage repair.

The initial canonical revision `e824ade90b214f6a0bf124b3a6038304565ac560`
was cherry-picked as `91195ab` onto verified integration `f1ce2fa`; the latest
update was cherry-picked as `1408f60`. All 62 migrations replay with the existing
native sequential suites. No hosted database, real accounts, AI provider or HTTP
endpoint was accessed.

## Reproduce

```sh
# Desired assertions on 60a3ab7: exits 1, with 1 failure / 48 checks.
npm run test:db -- --feedback-storage-review

# Independent positive regression: seven assertions currently pass.
npm run test:db -- --coach-rating-contract

# PostgreSQL 17, synthetic data, private Unix socket, no TCP or inherited target.
# Runs the sequential audit, overlapping transactions and restricted grants.
TRAK_TEST_PG_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/test-feedback-review.mjs
```

On Linux, point `TRAK_TEST_PG_BIN` at the installed PostgreSQL 17 binary directory
(for example `/usr/lib/postgresql/17/bin`). The native runner creates and removes
its own cluster; it cannot accept a hosted database URL. Audit SQL rejects an
unmarked connection. Do not run these fixtures against a shared database.

The feedback audit remains opt-in and nonzero while the implementation is
unrepaired. Existing green CI does not prove these new assertions pass. Never
invert the assertions or accept the failing exit status as release success.

## Latest update: 60a3ab7

The original 47 sequential assertions now pass. The expectations accept safely
server-stamped academy IDs and the exact deliberate assessment-validation error;
arbitrary errors still fail. Adding the published-draft deletion regression
produces **1/48 failed desired assertions; all 33 controls pass** on both PGlite
0.5.8 / PostgreSQL 18.3 and native PostgreSQL 17.11. The same final assertions
against the original unmodified `e824ade` migration fail **15/48**, with all 33
controls passing, confirming the repaired expectations still catch the old bugs.

Native first-publication concurrency now passes: the second transaction waits,
revisions are 1 and 2, and exactly one current publication remains. Both intended
coach/adult reads also pass under restricted default grants. Seven generated
rating assertions and the existing sequential suites pass. The 12 native runner
safeguard tests, focused lint, syntax and whitespace checks pass.

| Finding | Reproduced outcome | Required repair |
| --- | --- | --- |
| FS7: published draft deletion | The owning coach deletes a referenced draft; `ON DELETE SET NULL` clears the publication's draft identity and removes its generated text/model/source history | Preserve referenced provenance with an enforcing FK or equivalent concurrency-safe restriction; ordinary deletion must not turn AI-assisted history into apparently manual feedback |
| FS8: departure during publication | An authenticated academy admin executes the real `remove_coach_from_org` and holds its transaction open. The publishing coach passes authority checks against the old visible state, then waits on the roster lock. After removal commits, publication still succeeds: three total revisions, including one unauthorized new publication | Acquire the roster lock before ownership/role/consent checks and evaluate authority after the wait, before publication work |

FS7 accepts permission/RLS denial or SQLSTATE `23503` naming exactly
`player_feedback_draft_id_fkey`; unrelated errors fail. It does not prescribe
whether an unused draft can be discarded. A snapshot-only `NOT EXISTS` delete
policy needs concurrency protection too; do not rely on it alone. An FK change
must also preserve intended account/roster deletion behavior.

FS8 uses a synthetic adult, independently of the deferred consent-test conversion.
The runner observes the blocked connection, commits the actual removal, and checks
both the RPC result and preserved publication rows. A timeout cannot count as a
successful denial. The final native audit **exits 1** for FS7 and FS8 and confirms
that its temporary cluster stopped and directory was removed. Green ordinary CI
does not clear these opt-in failures. P4 remains dependent on their repairs and
the academy-specific effective-consent contract.

## UI/edge expansion at e7371a7 (source review only)

PR40 subsequently added four frontend/edge files at
`e7371a7adce53d18e2a42e8e0fbdaabf57f83536`. The storage migration is byte-identical
to `60a3ab7`, so neither FS7 nor FS8 is repaired. This review branch retains the
storage snapshot; the following exact-head source findings have not been run as
browser/provider tests and are not a claim of additional runtime reproduction.

- Reopening and editing a publication loses its assessment association.
  [CoachReviewFeedback lines 83–94](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/e7371a7adce53d18e2a42e8e0fbdaabf57f83536/src/pages/coach/CoachReviewFeedback.tsx#L83)
  load text/date but not draft identity. The update passes null `p_draft_id` at
  line 145; the RPC derives assessment only from a draft. The replacement has
  null assessment, so the player's assessment-filtered query at line 317 cannot
  retrieve it and displays the awaiting-coach state.
- The new route exists in `App.tsx:113`, but there is no navigation to it in
  `src`. Assessment submission still returns home. Provide a reachable approval
  entry point and test the routed journey.
- The review effect at lines 58–60 resets loading/error without clearing draft,
  draft ID or publication state. Navigating from assessment A to B can retain A's
  text when B has no publication. Generation responses at 126–127 also lack an
  account/assessment cancellation check. Bind state and responses to their owner
  and reject late results before allowing publication.
- [The edge validation at line 174](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/blob/e7371a7adce53d18e2a42e8e0fbdaabf57f83536/supabase/functions/player-feedback/index.ts#L174)
  accepts any nonempty `points` array, including `[null]`; coach rendering at
  line 230 dereferences `point.title`. Validate the full payload before storing
  it and handle malformed stored responses without crashing.

The existing consent/AI-purpose boundary also remains: generation reads private
notes and calls the provider without an effective-consent check first. The
player's DEV branch still generates feedback from notes. These require their own
decisions/repairs and must not be counted as solved by publication storage.
Findings were sent in the authorized
[review channel thread](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789728982708799).

## Original e824ade findings (historical; repaired by 60a3ab7)

| Finding | Observed result | Required repair |
| --- | --- | --- |
| FS1: publication table client writes | Six assertions fail: direct insert bypasses missing consent, author/academy can be forged, revisions can be overwritten, restored or deleted | Remove direct publication DML from client roles; preserve history through a guarded publication operation |
| FS2: draft provenance | Five assertions fail: creator, academy and assessment can be forged or reassigned; the real publish RPC accepts an own-roster draft referencing another child's assessment | Derive and validate author/academy/assessment relationships on the server; make identity/provenance immutable |
| FS3: withdrawal reads | A child still reads one current publication after the real sole guardian withdrawal RPC; the existing consent helper correctly reports approval missing | Enforce effective consent at read time, including the eventual academy/purpose contract |
| FS4: broad default privileges | Both anonymous and authenticated database roles can truncate the two feedback tables in the legacy-grant fixture | Revoke inherited broad privileges explicitly and grant only intended operations |
| FS5: overlapping first publication | Both independent transactions succeed as revision 1, leaving two current publications | Serialize publication per roster and enforce unique current/revision identities |
| FS6: restricted default privileges | Valid RPC publication succeeds, but both owning-coach and linked-adult reads fail with permission denied | Include explicit intended table grants in the migration; do not rely on project defaults |

The 33 passing controls include valid draft/publication, sequential supersession,
linked-child current-only reads, private-draft denial, foreign-academy/unrelated
identity denial, deliberate RPC errors and preservation after unexpected writes
are rolled back. The withdrawal case has exactly one guardian and age 11, so it
does not assume the pending rule for multiple guardians or conflate this new
read-policy defect with P2's inherited threshold of 15.

FS4 is an actual database-role privilege test under the harness's broad default
grants. It is **not** proof of a publicly exposed HTTP truncate endpoint or of
the production project's exact grants. Table separation alone does not remove
the child's grant: coaches and children share the `authenticated` database role.

The concurrency runner deliberately keeps transaction A's successful publication
uncommitted while transaction B invokes the real RPC. It observes whether B
finishes or waits for a lock before committing A. No application function or
trigger is replaced. The desired outcome is two preserved revisions, 1 and 2,
with exactly one current publication containing B's text.

For FS6 the runner replays a second database in the same private cluster, revoking
automatic table grants immediately before the unmodified PR40 migration. All
earlier migrations and sequential suites still pass. Both positive read checks
then fail because PR40 grants no table access. Supabase's current
[API security documentation](https://supabase.com/docs/guides/api/securing-your-api)
distinguishes object grants from RLS and recommends declaring both explicitly.

Final native result: **exit 1**, with the 14 sequential failures, one concurrency
failure and two restricted-default read failures above. The native runner logs
successful cluster shutdown/removal after this expected red audit. Existing
sequential suites and the seven rating assertions pass. Focused JavaScript lint,
syntax checks, whitespace checks and the existing 12 runner safeguard tests pass.

## Rating correction

The routed assessment form correctly writes the six raw scores and omits
`coach_rating`: PostgreSQL stores their rounded mean. Seven actual-role SQL
assertions verify generated-column identity, active RLS, zeros yielding 0,
`10/9/8/7/6/5` yielding 7.5, and updates yielding 6.2 without changing the other
assessment. These pass on PGlite 0.5.8 / PostgreSQL 18.3 and native PostgreSQL
17.11. A deployed NULL requires checking the live schema/query response.
Consumers using `coach_rating || 5` still misclassify zero; Kostas owns that fix.

## Remaining boundaries

Parent publication policy is deliberately absent in PR40; P4 must wait for the
approved storage and P2 read contract. This review does not authorize copying
historical notes into publication tables. K9 private-note access and T2's edge
function/review screen remain separate work. The native race is a correctness
test, not a traffic-capacity benchmark. Hosted grants, Auth/PostgREST, real
devices and actual deployment remain unverified by these tests.

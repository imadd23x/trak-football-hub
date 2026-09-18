# PR40 feedback storage review — September 18, 2026

**Not ready to merge.** The two-table design is a useful publication boundary,
but the submitted grants, policies and publication transaction do not enforce
the agreed contract. This branch contains executable review tests, not repairs.

Reviewed canonical PR40 `e824ade90b214f6a0bf124b3a6038304565ac560`, cherry-picked
as `91195ab` onto the previously verified integration `f1ce2fa`. All 62
migrations replay with the existing native sequential security suites. No
hosted database, real accounts, AI provider or HTTP endpoint was accessed.

## Reproduce

```sh
# Desired security assertions: currently exits 1, with 14 failures / 47 checks.
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

## Reproduced failures

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

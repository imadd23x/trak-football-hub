# Consent/privacy audit gate

This branch integrates only the existing CP1–CP4 audit from `78f771b`. It does
not implement consent policy or convert the parked zero-approval tests. There
are no application or migration changes. It depends on the merge-governance
change at `fe49465cf118a4b7d7a0a44521a447ff0629d8d7` and must not merge first.

## Observed baseline, not privacy approval

The actual CLI replay at `e9789c11da81414ab51eb7c697f2610af80c6d4c` ran all 62
candidate migrations in a new in-memory PGlite database. All 27 assertions ran:
19 controls passed and these eight checks failed:

- `CP1.child-private-note-denied`
- `CP2.visibility-assessment-denied`
- `CP2.visibility-award-denied`
- `CP2.visibility-match-denied`
- `CP3.withdrawal-assessment-denied`
- `CP3.withdrawal-award-denied`
- `CP3.withdrawal-match-denied`
- `CP4.recognition-insert-denied`

The raw result is [consent-audit-observation.json](consent-audit-observation.json).
The proposed [baseline](consent-audit-baseline.json) records those exact IDs,
including every passing control. It was derived only after the committed runner
executed; capture mode exited **1** because the security assertions failed.
Its contents still require independent human review. Ratchet success means
unchanged, named debt; these privacy failures remain real-child admission
blockers. It does not mean consent, withdrawal, or private notes are safe.

## Revisions and execution

1. Runner/inventory commit: `e9789c11da81414ab51eb7c697f2610af80c6d4c`.
2. Baseline/observation commit: `8fcd564ebda05f60b271a4df6d68bed333e1d253`.
3. A subsequent CI commit pins those already-existing Git objects. No report
   needs to predict its own future commit SHA.

The dedicated **Consent privacy audit** job checks out the exact workflow
candidate (`github.sha`) into `candidate` and the fixed policy commit into a
different directory. For PR events the candidate is GitHub's test merge commit;
for push events it is the pushed commit. It installs dependencies from the
trusted checkout's committed lock with lifecycle scripts disabled, then executes
that checkout's runner and evaluator. It has read-only repository permission,
no hosted keys, and no database URL input or network database connection.

The runner requires the candidate checkout HEAD to match the externally supplied
SHA and rejects dirty or untracked migrations. It reads every migration from
that exact Git tree, not editable working files. Runner JavaScript, evaluator,
SQL, inventory, bootstrap, package manifest and lock must match the pinned
runner commit byte for byte. Baseline JSON is read from the pinned policy Git
object, not the candidate's baseline file. Changing a candidate JSON file
cannot grant itself new debt. The workflow pin itself remains protected by the
independent code-owner review model described in [merge-gate.md](merge-gate.md).

To run locally after the reviewed commits exist, set `CANDIDATE_SHA` to the
full current candidate commit and use a report path that does not already exist:

```sh
node scripts/audits/consent-runner.mjs \
  --candidate-root . \
  --candidate-revision "$CANDIDATE_SHA" \
  --runner-revision e9789c11da81414ab51eb7c697f2610af80c6d4c \
  --policy-revision 8fcd564ebda05f60b271a4df6d68bed333e1d253 \
  --report /private/tmp/consent-audit-candidate.json

node --test tests/governance/consent-runner.test.mjs
node --test tests/governance/*.test.mjs
```

Use a separate trusted checkout when candidate runner files differ. The CLI
prints the complete evaluation and appends the per-assertion result to
`GITHUB_STEP_SUMMARY` when supplied. Without `--policy-revision`, it captures
fresh observations and exits nonzero for any failed assertion; it never writes
a baseline. New baseline revisions require review and an explicit workflow pin
update. A repaired expected failure requires a baseline reduction; later
recurrence is rejected.

## Failure handling and discrimination

The SQL port preserves actual `authenticated` role switching, real grant and
withdrawal RPCs, and all original behavior assertions. Its new result envelope
contains explicit stable IDs, kinds and pass/fail states. It uses no broad
exception handler to turn runtime errors into passing denials. Only permission
denial is accepted by the denial helpers; an unexpectedly successful award
write is rolled back and recorded as a failure. All fixtures then roll back.

The runner requires exactly one complete result envelope with the entire
reviewed inventory. Missing, duplicate, unknown, wrongly classified or corrupt
results are errors. Bootstrap, migration, fixture, parser, rollback-verification,
rollback-cleanup and database-close failures are unconditional suite errors.
Failure to create a report or append a requested summary also exits nonzero.
The ten-minute job deadline prevents a hanging execution from passing.

Focused tests verify these failure paths and real database discrimination.
Adding a permissive note-read policy **only in memory** changes the result to
nine failures, including `control.parent-private-note-denied`; the unchanged
baseline rejects it. A real undefined-column query returns SQLSTATE `42703`
and suite `error`, never a passing denial. No fixtures touch a hosted database.

## Activation and limits

CI wiring and the proposed branch-protection file add **Consent privacy audit**
as a separate required check. Supabase and Deploy explicitly require its
successful result, including Deploy's `always()` path. Nothing here activates
hosted protection: an authorized administrator must apply and read back the
configuration after this workflow reports on a fresh PR. Fork CI at `2045b25`
[passed the actual audit](https://github.com/imadd23x/trak-football-hub/actions/runs/35358713512),
but that does not establish canonical integration or active hosted protection.

This is a fresh-install SQL replay using the pinned PGlite dependency and the
existing minimal Supabase test bootstrap, not hosted Auth/PostgREST or native
PostgreSQL concurrency verification. Existing ordinary security and upgrade
tests remain wired separately. It does not prove under-18 academy-specific
approval, multi-guardian rules, real notice wording, or admission readiness.

The separate `shared/roster-audit-gate` branch at `b0e3ef9` repairs the roster
controls and verifies 21 assertions, including seven controls, with deliberate
runner mutations. Its integration is still pending. Preserve both audit jobs,
required check names and explicit production success conditions when combining
the branches. FS7/FS8 require the unmerged T2 contract and FS8's native
concurrency runner. Neither other suite is represented as
passing, skipped or accepted-debt suites in this gate. Integrate them separately
under the [audit contract](audit-contract.md). Rollback removes this new job and
its proposed required check together; it must not silently relax audit debt or
be used to authorize real children while the named privacy failures remain.

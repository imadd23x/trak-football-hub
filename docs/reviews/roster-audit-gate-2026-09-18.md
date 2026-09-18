# Roster identity audit gate

Scope: separate follow-up to governance base `fe49465cf118a4b7d7a0a44521a447ff0629d8d7`.
No application, migration, hosted data or production changes. The governance PR
must land first; this branch and its pins still require independent review.

## Observed baseline and execution

Runner and observed candidate: `781f4d423a4f85c7658dfbae53e8002e96773db3`.
Inventory: `415a796af366e436de3c36c1e2f8a716da14ce0c`.
Replayed **62 real candidate migrations** in an in-memory PGlite 0.5.8 database.
All **21 assertions passed: 14 behavior checks and 7 positive controls**.
The baseline expects every assertion to pass; there is **no accepted roster debt**
inside this limited inventory. The old historical “3/6” is not used as a budget.

`supabase/tests/roster_adoption.sql` uses synthetic adult fixtures, actual
`SET LOCAL ROLE authenticated` plus actor JWT claims, and real linking RPC/RLS.
Each player has an independently linked assessment under a different coach as a
same-actor, same-operation positive read control. The different coach avoids the
target RPC's already-linked shortcut. Exact-name adoption returns the original
roster ID, exposes both original assessment IDs, and repeats sequentially without
creating a second linked row. Owner snapshots separately prove typo and both
namesake identities, assessment values and history associations survive intact.
Wrong-child history stays hidden from the authenticated player.

The trusted runner reads candidate migrations from the explicitly supplied Git
commit, not mutable working files. Its own script, SQL, bootstrap, evaluator,
package manifest and lockfile must match the baseline's pinned runner commit;
inventory bytes must match the pinned inventory commit. The CLI reads the baseline
from a separately pinned Git commit. CI checks out that trusted fork commit and
the candidate separately; it uses the trusted dependency lockfile and no hosted
database target or production credentials. These pins require reviewer approval;
self-authored pins do not create independent approval or prevent workflow edits.

The dedicated **Roster adoption audit** job prints the complete JSON report and
adds every assertion and provenance field to Step Summary. Missing, duplicate,
incomplete or malformed output, SQL/fixture errors, failed controls, unexpected
failures and cleanup errors reject the gate. Fixture rollback is verified. The
proposed protection configuration requires this job; activating protection remains
an administrator action. Supabase and Deploy explicitly require its success.

## Verification and discrimination

```sh
node --test tests/audits/roster-adoption.test.mjs
node scripts/audits/roster-adoption.mjs \
  --candidate-root /path/to/candidate \
  --candidate-revision FULL_CANDIDATE_SHA \
  --baseline-revision FULL_REVIEWED_BASELINE_SHA
```

All **11 runner tests passed** after independent review strengthened target-coach
verification and owner checks strengthened sequential idempotency. Disposable in-memory mutations prove:
- denying assessment reads fails all three same-player read controls;
- returning a membership under a different coach fails both fallback-link assertions;
- returning the correct original ID while inserting hidden unlinked duplicates fails
  the owner postcondition;
- granting all assessment reads fails both wrong-child read assertions;
- choosing one ambiguous namesake fails link, visibility and identity checks;
- deleting one namesake fails identity and history preservation;
- missing/incomplete/duplicate/misclassified output and unexpected fixture SQL
  errors are fatal, with rollback checked;
- a non-disposable marker is refused; changed/missing trusted inputs are refused;
  dirty candidate SQL is ignored in favor of exact Git objects.

The source suite passed **319 tests**, the harness **17**, and governance **69**
(including the new workflow contract). Default and deployed-parent-upgrade SQL
modes both passed with 62 migrations and 282 operational-view assertions.
Typecheck/build/lint passed; lint retains 136 warnings and build its chunk-size
warning. `uc:check` exited zero with the existing three pending UC-A02 failures
visible; that is not a claim that every use case passes. No browser rerun was
needed for this test-only change. Exact merged-governance rerun evidence will be
recorded with the final candidate.

## Limits and unresolved product work

The earlier PR42 suite changed JWT claims while retaining the database owner
role, so successful player reads did not prove RLS. It also expected typo adoption
and fewer ambiguous rows, although the shipped RPC deliberately adopts only one
exact-name match. Reducing duplicate counts could select the wrong identity or
delete another person's history. Those unsafe expectations are not grandfathered.

This audit does **not** resolve T4 history recovery: typo/nonmatching and ambiguous
names may still create a fresh linked row while original unlinked history awaits
an explicitly verified reconciliation workflow. Its UX, identity verification and
repair contract remain product debt. There is no fuzzy adoption or no-third-row
assertion. Name matching itself is not proof of a real-world identity. The suite
does not prove concurrency, native PostgreSQL lock behavior, browser/onboarding,
HTTP Auth, email, minors/consent or live deployment. Existing default SQL suites
and upgrade-order tests remain separate and unchanged.

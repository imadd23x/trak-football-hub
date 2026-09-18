# Merge and deployment gate

This is the canonical release policy for Codex, Claude Code and human reviewers.
`AGENTS.md` and `CLAUDE.md` point here; technical orientation stays in `CLAUDE.md`.
Green CI alone is insufficient: source checks, independent review, applicable
runtime audits and explicit production approval are separate requirements.

## Authority and coordination

Imad coordinates releases. Kostas or Tarek approves Imad's PRs; Imad merges only
after approval of the tested revision and explicit approval for the production
change. An agent's self-review is not independent human approval. Do not infer
permission to merge/deploy from permission to implement a task.

Use a separate `parent/`, `coach/`, `player/` or `shared/` task branch. All
Imad/Codex changes are committed and tested in `imadd23x/trak-football-hub` before
a PR to canonical `kostasanastasioubusiness-lang/trak-football-hub:main`. Never
push directly to main. Preserve other task branches and unrelated local changes.
Announce migration tables/RPCs and shared-file reservations in
#coding-agent-reviews before editing; post review and release evidence there.

Never apply development SQL or fixtures to the shared live Supabase project.
Use disposable databases and synthetic identities. Hosted fixtures, emails,
credential rotation, production configuration, merges and deployments need
explicit authorization. Do not copy production credentials into the fork.
Fork CI executes tests only; repository guards exclude production deployment.

## Before merge

1. Merge or rebase current main into the task branch. A required check on an old
   head is not approval of the new head. Resolve dependencies, migration order,
   callers/types and compatibility with existing or cached clients.
2. Run `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run build`,
   `npm run lint`, `npm run uc:check`, relevant SQL/browser tests and
   `node --test tests/governance/*.test.mjs`. Preserve existing checks when
   resolving workflow conflicts. Pending use-case failures are debt; require
   the changed journey and its positive controls to pass.
3. Review named audits separately until their actual runners and reviewed
   inventories are integrated. No suite output, skipped tests, setup failures,
   failed controls and unexpected SQL errors are not passing denial tests.
4. Obtain an independent teammate's formal GitHub approval on the tested
   revision. Resolve review conversations and re-review after changes. Agent
   comments and Slack discussion help review but are not formal approval.
5. Obtain Imad's production-release approval, record the expected backend and
   frontend changes and the recoverable failure plan. Merging currently starts
   production CI automatically; a PR preview is not a production authorization.

### Dependencies and current main

The existing `.github/workflows/merge-base.yml` provides the required **Merge
policy** check. It rejects non-main targets, candidates missing current main,
other open PR heads present in the candidate but absent from main, and declared
undelivered dependencies. Shared history already on main is not a dependency.

Declare additional dependencies as `Depends-on: #34` (one per line, or a
comma-separated list). Declaration supplements ancestry detection: edited,
partial or cherry-picked changes cannot reliably be discovered from head
ancestry alone. A closed/merged badge on a different base is insufficient. For a
squashed/rebased dependency, its recorded merge result must actually reach main.
Independent branches sharing only main history remain valid.

The check reads all pages of GitHub PR/review inventories, validates exact
base/head revisions, and fails when API/Git evidence is unavailable. Its result
is a snapshot, not an atomic repository lock. Main changes require an updated
candidate and fresh checks; review/body changes rerun the policy. Re-running a
workflow for an obsolete revision does not approve current work. Manual workflow
dispatch is diagnostic; required checks must be recorded on the current PR.

### Migration order

Never edit, remove, rename or change the executable mode of an existing main
migration. Create a forward migration with the Supabase CLI. The check compares
actual main and candidate trees, ignoring old diff entries already identical on
main. Duplicate versions and unsupported migration paths fail.

A newly added version at or below main's newest version requires an exception.
`--include-all` applies missing older versions; it does not establish semantic
safety. Test both a fresh replay and the real deployed-to-candidate upgrade
order in a disposable database, with relevant backfill, role and data controls.
Record the live migration-version snapshot used. Applied migrations stay intact.

The PR author supplies exactly one one-line JSON acknowledgement (replace the
illustrative values):

```text
migration-order-ack: {"base_sha":"FULL_CURRENT_MAIN_SHA","migrations":["20260918062345_preserve_academy_access_and_fk_cleanup.sql"],"evidence_url":"https://github.com/OWNER/REPO/actions/runs/RUN_ID"}
```

A collaborator other than the author must submit an **APPROVED GitHub review on
this exact candidate head**, with a matching one-line JSON marker:

```text
migration-order-approved: {"base_sha":"FULL_CURRENT_MAIN_SHA","migrations":["20260918062345_preserve_academy_access_and_fk_cleanup.sql"],"evidence_url":"https://github.com/OWNER/REPO/actions/runs/RUN_ID"}
```

The filename set must exactly match older additions. The evidence must be a
completed successful Actions run for the candidate head in canonical or its
candidate fork. The reviewer must inspect the actual upgrade order and results:
a green arbitrary workflow alone does not prove them. The automatic check
validates the evidence reference and independent sign-off, not the semantic
quality of that review. Author/bot approvals, stale/dismissed approvals, changed
base/head, wrong filenames and failed/mismatched runs cannot authorize the
exception. New main requires new order evidence and approval. Ordinary later
migrations still require normal SQL tests and review.

## Audit debt is explicit, not a failure allowance

Follow [the audit contract](audit-contract.md). Baselines pin assertion identities,
positive controls and runner/inventory revisions. They do not permit a numerical
budget of failures. Fixing one old defect must not offset a new one. Missing,
duplicate, skipped or errored assertions and failed controls always reject the
gate. When an expected failure is fixed, retain the assertion and reduce its
accepted debt in an independently reviewed update. Candidate output cannot
approve its own baseline changes.

The focused governance change supplies and tests this evaluator. It does not
claim the real consent/privacy, feedback/storage or roster-adoption audits are
already CI gates. Their historical counts come from different revisions and
engines. Integrate actual runners separately, rerun the exact candidate, preserve
feedback's native PostgreSQL concurrency test, and repair weak controls before
accepting a baseline. A missing feedback schema is a dependency, not expected
failure or a reason to fabricate skipped green results. Known privacy failures
remain real-child admission blockers even when unrelated development can proceed.

## Activate protection (repository administrator)

`docs/release/main-branch-protection.json` is a proposed configuration, not proof
that protection is enabled. The September 18 check reported Imad has repository
write access, not administration. Do not activate or relax settings without
explicit authorization. An authorized administrator should:

1. Confirm this policy and workflow are on main, **test** and **Merge policy**
   have reported on a fresh PR, and each listed CODEOWNER has repository write
   access. All ownership areas include alternates so authors can obtain review.
2. Apply the reviewed config and then read it back:

```sh
gh api --method PUT repos/kostasanastasioubusiness-lang/trak-football-hub/branches/main/protection --input docs/release/main-branch-protection.json
gh api repos/kostasanastasioubusiness-lang/trak-football-hub/branches/main/protection
```

3. Verify required current checks, independent/code-owner approval after the
   latest push, stale-review dismissal, resolved conversations, administrator
   enforcement and blocked force-push/deletion. Prove a red/unapproved candidate
   cannot merge without merging that candidate. Do not require the post-merge
   **Supabase**, **Deploy** or **Verify merged delivery** jobs on a PR.

CODEOWNERS routes requests by actual file paths. Any listed owner may satisfy the
code-owner requirement; listing several people does not require every one to
approve. The independent-review rule is enforced by GitHub protection, not by
CODEOWNERS alone. The check code and its workflow are themselves review-owned.
PR check execution has read-only GitHub permissions and no production secrets;
there is no privileged `pull_request_target` job executing candidate code.
Like ordinary source tests, the PR policy script is candidate-owned code. A PR
can propose changes to its own checks; the protected independent review of
workflows/guards is therefore essential. This is not a tamper-proof external
policy service, and it must not be described as one.

## After merge and before production

The main CI `test` job runs delivery verification before its application checks
and before either production job. It rejects direct main pushes with no recorded
PR result, forced/non-forward pushes, divergent history, a PR merged into another
base, absent merge
results, incomplete/wrong changed-file inventory, and file objects that differ
from the reviewed PR. It uses GitHub's actual
`merge_commit_sha`, so ordinary, squash and rebase merges can all be verified.
The separate closed-PR job also reports delivery failures after a merge.
Main is reread at the end. If a newer ordinary merge has advanced main beyond the
event revision, before or during verification, the older run reports **superseded**
and sets `release_eligible=false`; this is not a failed candidate or verified
delivery. Both production jobs require explicit affirmative eligibility, so a
superseded run cannot deploy. Forced/non-forward events, resets/divergence and
unavailable evidence still fail. The current revision must pass its own checks.

This post-push check detects delivery defects; it cannot prevent the merge itself.
Eligibility is a snapshot before application checks, not an atomic branch lock.
Main can still advance afterwards; maintain the human release lock through both
production jobs and verify live results. Workflow serialization alone does not
freeze main or authorize rapid consecutive schema releases.

Because the policy requires current main in the candidate, each delivered changed
file must match the reviewed PR's Git object hash, including squash/rebase results.
A combined merge requiring different contents must be updated and reviewed first.
Exact file delivery still does not prove application correctness: run behavior
tests on the delivered commit. Source CI passing does not prove
hosted migrations, functions or frontend deployment happened.

Wait for the full workflow before the next schema merge. Current main workflows
are serialized and are not cancelled by new pushes, but serialization alone does
not guarantee every pending revision deploys or that later jobs stop after an
older failure. Keep a single human-coordinated release in flight. The separate
S4 queue candidate must be reviewed rather than silently assumed deployed.

Verify both production jobs and the routed journey on trakfootball.com using
designated synthetic accounts. A preview sharing the backend cannot validate an
unapplied migration. Record merge/result commit, workflow URL, migration versions,
function versions, frontend deployment, role, expected/observed outcome,
browser/phone and remaining limitations. Report merged, deployed and verified
as separate states in Slack.

## Failed release

Stop the merge queue. Determine which migrations/functions actually applied;
a red job does not roll back successful earlier steps. Repair schema/permissions
with reviewed forward migrations. A previous compatible frontend can be restored
while retaining security fixes. Never erase migration history, bypass required
reviews, silently increase accepted audit debt or restore an older access-control
vulnerability as a rollback shortcut.

The second academy supplies isolation fixtures, not a staging environment or
backup. Real-child admission additionally requires every applicable gate in the
current pilot-readiness document.

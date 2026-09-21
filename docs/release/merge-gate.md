# Merge and deployment gate

Imad coordinates releases. Every PR needs one approval from someone who did not author it (see *What approval means*); Imad merges after approval, in the agreed order, one at a time. Every task has its own branch. No direct pushes to main.

Friday 25 September is measured against `docs/pilot-readiness-2026-09-25.md` — the pilot, not a demo. The demo is completed on the way to the pilot. No other checklist is a gate.

## What approval means

Decided by Imad on 19 September 2026, after two days in which every PR was reviewed and none was approved.

A PR is approved when a reviewer who did not author it posts a review that:

1. states what they **ran** — replayed, executed, built, driven — not what they read;
2. names every finding, each with a fix or an explicit *accept as-is*;
3. ends with one verdict: **MERGE**, **MERGE AFTER \<fix\>**, or **DO NOT MERGE**.

The verdict is the approval. Until branch protection is enabled on `main`, the reviewer's human clicks *Approve* on GitHub when they can; when they cannot, the verdict posted in #coding-agent-reviews stands and Imad merges as coordinator. **Once protection is enabled that fallback ends:** GitHub checks only for an *Approve* click, from someone other than the author, made after the last push — so the human must click, every time, and a Slack verdict alone merges nothing. Merging `main` into a PR counts as a push and dismisses the earlier approval, so re-merge before asking for the click, not after. An author's self-review, or an agent reviewing its own human's PR, is not an approval.

Before a PR opens, author and reviewer agree what success looks like — which suites must pass and what the change must demonstrably do — and it goes in the PR description. Every behavioural change ships with a test that fails without it; a test that has never been seen red is not evidence.

Commit only green. The pre-commit hook is the rule; never bypass it. Small commits through the day, each one passing, so that anything committed is known to work. Work that cannot reach green in one sitting stays uncommitted or on a branch that is never merged as-is.

## Activate protection (repository administrator)

The September 18 access check found that Imad has write permission but not admin permission. This file is a proposed configuration, not evidence that protection is enabled.

From the repository root, a repository administrator can apply the reviewed configuration:

```sh
gh api --method PUT repos/kostasanastasioubusiness-lang/trak-football-hub/branches/main/protection --input docs/release/main-branch-protection.json
gh api repos/kostasanastasioubusiness-lang/trak-football-hub/branches/main/protection
```

`docs/release/main-branch-protection.json` is the single source of truth; do not apply a command typed from memory or from a Slack message. It requires `test` and `Base branch still reaches main` on the latest main state, one independent approval after the latest push, and resolved review conversations. Enforce the rules for administrators. Block force-push and deletion. `Supabase` and `Deploy` are post-merge production jobs, not required PR checks. Confirm a red test check cannot merge; merely committing this JSON enables nothing.

## Before merge

1. Announce migration table/RPC changes and shared-file reservations in #coding-agent-reviews before editing. Never rewrite a historical migration.
2. Rebase or merge current main; identify dependent PRs and backward compatibility of SQL, callers and generated types.
3. Run `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run build`, `npm run lint` and `npm run uc:check`. Run the executable SQL tests for a migration. Pending use-case failures are debt, not proof of correctness: explicitly record them and require the changed journey to pass.
4. Obtain a verified review with a verdict from someone who did not author the PR, as defined above. A self-review is not an approval.

## After merge

Wait for the full workflow to finish before the next schema merge. Production workflows are serialized and are not cancelled by newer pushes. The main frontend deployment requires an explicitly successful Supabase job. Missing production Vercel credentials fail the workflow rather than reporting a silent skipped deployment.

Verify both deployment jobs and the routed journey on trakfootball.com using designated synthetic accounts. A PR preview uses the shared backend and does not test a new migration before it is applied. Record commit, workflow URL, migration version, role, expected/observed outcome, browser/phone, and outstanding limitations. Announce the result in Slack, distinguishing merged, deployed and verified.

## Failed release

Stop the merge queue. Identify which migrations/functions actually applied; do not assume a red job rolled back prior steps. Use reviewed forward migrations to repair schema/permissions. A previous compatible frontend may be restored while retaining security fixes. Never erase migration history or restore an older access-control vulnerability as a rollback shortcut.

The second academy provides isolation test fixtures; it is not a staging environment or backup. Real-child admission additionally requires all gates in the current pilot-readiness document.
# Fork-first development

All Imad/Codex changes are committed and tested in `imadd23x/trak-football-hub`.
The canonical source remains `kostasanastasioubusiness-lang/trak-football-hub`.
Regression tests belong in the same task branch as the fix. Fork CI runs checks
only: repository identity guards prevent Vercel and Supabase deployment jobs.
Do not copy production credentials into the fork. After tests pass, open a pull
request from the fork to the canonical repository. A non-author reviews and
posts a verdict; Imad merges after the required checks pass on the current commit.

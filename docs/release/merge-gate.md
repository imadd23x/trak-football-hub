# Merge and deployment gate

Imad coordinates releases. Kostas or Tarek approves Imad's PRs; Imad merges after approval. Every task has its own branch. No direct pushes to main.

## Activate protection (repository administrator)

The September 18 access check found that Imad has write permission but not admin permission. This file is a proposed configuration, not evidence that protection is enabled.

From the repository root, a repository administrator can apply the reviewed configuration:

```sh
gh api --method PUT repos/kostasanastasioubusiness-lang/trak-football-hub/branches/main/protection --input docs/release/main-branch-protection.json
gh api repos/kostasanastasioubusiness-lang/trak-football-hub/branches/main/protection
```

Require `test` on the latest main state, one independent approval after the latest push, and resolved review conversations. Enforce the rules for administrators. Block force-push and deletion. `Supabase` and `Deploy` are post-merge production jobs, not required PR checks. Confirm a red test check cannot merge; merely committing this JSON enables nothing.

## Before merge

1. Announce migration table/RPC changes and shared-file reservations in #all-trak-football before editing. Never rewrite a historical migration.
2. Rebase or merge current main; identify dependent PRs and backward compatibility of SQL, callers and generated types.
3. Run `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run build`, `npm run lint` and `npm run uc:check`. Run the executable SQL tests for a migration. Pending use-case failures are debt, not proof of correctness: explicitly record them and require the changed journey to pass.
4. Obtain a teammate's approval. Do not accept an agent's self-review as the independent human approval.

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
request from the fork to the canonical repository. Kostas or Tarek reviews;
Imad merges after the required checks pass on the current commit.

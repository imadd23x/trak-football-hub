# S4 pending release queue — September 18, 2026

Candidate starts at `cae7471b5d5b6487eefc21dd8cc4afa3efb37561`, which already
contains the task-branch deployment guard and parent Settings locator repair.
Only the queue configuration, its regression contract and release documentation
change here. No application, schema, credential or deployment target changes.

## Failure and correction

The previous workflow disabled cancellation of a running main release, but left
GitHub's default single-item pending queue in place. A third push could replace
the second while the first was running. The cancelled main runs with zero jobs
are consistent with this behavior; their API metadata does not prove the exact
cancellation cause.

Pushes now resolve to `queue: max` with `cancel-in-progress: false`. PR events
resolve to `single` with cancellation enabled, preserving replacement of obsolete
PR checks. Both expressions use the same event predicate so the prohibited
`max`/`true` combination cannot occur. The group remains workflow + ref, spanning
tests, Supabase and Vercel rather than only one deployment job.

Acceptance: retain two pending push runs while another is running; complete all
three without overlapping jobs; retain the PR policy and all event/dependency
deployment guards. No hosted deployment is necessary to verify this change.

## Evidence

```sh
node node_modules/vitest/vitest.mjs run src/__tests__/release-workflow.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/release-workflow.test.ts
git diff --check
```

- Prior queue configuration: **2 failures / 17 passes**. The failures are the
  main/task push expectations; the default PR single queue already passes.
- Repaired configuration: **19/19 tests pass**. These evaluate the checked-in
  expressions and execute the existing guarded shell steps. They do not emulate
  GitHub's scheduler. Focused lint and whitespace checks pass.
- Independent source review checked expression context inheritance against
  [GitHub's workflow parser schema](https://github.com/actions/languageservices/blob/main/workflow-parser/src/workflow-v1.0.json).
- The separate fork branch `probe/S4-release-queue` copies the candidate's exact
  concurrency block into a harmless workflow. It has empty token permissions,
  no checkout, no secrets, no deployment commands and a fork identity guard.
  Its only step identifies the synthetic run and waits briefly. **Never merge
  that experimental workflow into the product.**
- At **12:54:50 UTC**, the GitHub API reported run **35347114446** in progress
  while **35347169689** and **35347179988** were both pending. This verifies
  actual queue pressure, not just three sequential successful dispatches.

All three jobs completed successfully, with nonoverlapping intervals:

| Probe | Commit | Job interval (UTC) | Result |
|---|---|---|---|
| [A — 35347114446](https://github.com/imadd23x/trak-football-hub/actions/runs/35347114446) | `4f4a9cf` | 12:53:57–12:55:33 | Success |
| [B — 35347169689](https://github.com/imadd23x/trak-football-hub/actions/runs/35347169689) | `5ecf50b` | 12:55:36–12:55:49 | Success |
| [C — 35347179988](https://github.com/imadd23x/trak-football-hub/actions/runs/35347179988) | `ba9c7e1` | 12:55:52–12:56:05 | Success |

This exercises the push configuration in GitHub's scheduler with synthetic jobs.
The PR branch is checked by the persistent expression tests and schema review;
no PR was opened just to exercise cancellation. It does not prove live
deployment behavior, queue-overflow behavior, or commit ordering.

## Limits, rollout and recovery

[GitHub documents](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
a maximum of 100 pending runs. Additional runs can still be cancelled. Queue
ordering follows arrival at the concurrency group, not guaranteed commit order;
an old run retried later can still deploy stale code. This change neither stops
later queued runs after a failure nor creates a deployment approval gate.

Keep one-at-a-time reviewed releases and wait for the full workflow before the
next schema merge. Hold production until the calendar migration and all matching
callers are compatible. This candidate requires teammate review and Imad's
production approval; fork CI and the queue probe are not deployment evidence.

If the new queue property blocks scheduling, forward-fix the configuration after
examining GitHub's validation error. The fallback is the prior documented
single-pending policy with strict manual release sequencing; never enable main
in-progress cancellation or bypass a failed backend. No database rollback is
involved.

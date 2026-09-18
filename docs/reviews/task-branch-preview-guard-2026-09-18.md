# S4 task-branch deployment guard — September 18, 2026

Prepared from canonical main `09d22d408b6633f1ca06d845853adfdca843a463` after
[Kostas's review](https://trakfootball.slack.com/archives/C0C2N0D1C06/p1789733396375039).
This candidate is fork-only until reviewed and approved for production. No
existing PR head or deployed workflow has been changed by this branch.

## Trigger and correction

A push to `parent/**`, `shared/**` or `develop` on the canonical repository
passed the previous Deploy condition after tests, even without a PR. It used
the repository's Vercel credentials and selected the **preview** environment,
with no `--prod` flag. Supabase deployment remained limited to main pushes.
Preview URLs appeared in logs/job summaries but received no PR comment. This
was a missing event restriction, not evidence that these pushes changed the
production frontend or database. No real task-branch deployment was performed
to reproduce it.

The repair keeps branch checks and permits deployment only for these events:

| Event | Credential check | Supabase deployment | Vercel deployment |
|---|---|---|---|
| Canonical main push | Yes | Existing test dependency | Production only after successful tests/backend and configured credentials |
| Same-repository PR | Yes | No | Preview only after successful tests, skipped backend and configured credentials |
| Canonical task/develop push | No | No | No |
| Fork push or fork-origin PR | No | No | No |
| Other event types | No | No | No |

The Vercel credential job uses the same allowed event families so a checks-only
run does not load deployment credentials. No secret values, project targets,
Supabase commands, build commands or database migrations change. The existing
main serialization and PR preview behavior are retained.
Push checks remain configured for `main`, `develop`, `parent/**` and `shared/**`;
this repair does not add push triggers for `coach/**` or `player/**`.

## Evidence

The persistent test reads and evaluates the actual YAML job expressions. Missing
PR metadata is represented as empty GitHub context values; it does not invent a
PR head on a push or turn absent nested fields into JavaScript exceptions.
Two tests execute only the checked-in target-resolution shell step with a
synthetic token, a private temporary output file and a restricted environment;
they confirm main selects production/`--prod` and PR selects preview/no flag.
No Vercel command, remote service or real credential is used by these tests.

```sh
node node_modules/vitest/vitest.mjs run src/__tests__/release-workflow.test.ts
node node_modules/vitest/vitest.mjs run src tests/msw tests/support
node scripts/test-db.mjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
node node_modules/vite/bin/vite.js build
node node_modules/eslint/bin/eslint.js .
```

- New expectations against the unchanged main workflow: **7 fail / 7 pass**.
- Repaired workflow: **14/14 pass**, including denied task/develop pushes,
  fork-origin previews, missing credentials, failed/skipped tests, failed backend
  and undeclared event types; legitimate release/preview controls pass.
- Source and harness suites: **190 pass**.
- Operational-view SQL: **282 assertions pass**, with all **58 migrations**
  replayed in the disposable database.
- App TypeScript and build pass. Lint has **0 errors / 140 existing warnings**;
  the existing large-chunk build warning remains. Whitespace checks pass.

These tests prove the event/target behavior of this workflow file, not GitHub
branch-protection configuration or a hosted deployment. Other pilot acceptance
and consent/feedback failures are unaffected and remain release blockers for
their flows.

## Review, rollout and recovery

Keep this change isolated in the fork and preserve the current review queue.
Obtain Kostas/Tarek review of the final commit and explicit production approval
before promoting it to the canonical workflow. After a reviewed merge, verify
the actual main run: tests and Supabase succeed before production deploy. For
subsequent legitimate task pushes/PRs, record expected skipped/preview jobs and
their run URLs without creating a live deployment merely as a test.

If the guard blocks a legitimate release, inspect the actual event and dependency
results and forward-fix the narrow condition. Do not restore the broad push
condition or bypass a failed backend. No database rollback is required for this
workflow-only repair.

## Review clarification

PR35 merged at 14:05 Dubai on September 18; its
[production workflow](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/actions/runs/35332878336)
finished successfully at 14:08, including migration push. Migration
`20260918070209_restrict_pilot_operational_views.sql` explicitly sets
`security_invoker`, revokes broad grants and grants service-role SELECT. The
restricted metadata observed at 16:09 is consistent with that deployment and
does not establish manual schema drift. Broader report-inventory test coverage
and stale rehearsal-document instructions remain separate review findings.

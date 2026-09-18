# Reviewed governance candidate — 18 September 2026

Base: canonical `00910940f596d9fe9a7cd416dc741943d1df2cc9`.
Fork branch: `imadd23x/trak-football-hub:shared/merge-guardrails`.

## Result

Extends the existing merge-base workflow into a PR policy check; adds delivery
verification before the main production pipeline; centralizes release rules;
prepares independent/code-owner review enforcement; and supplies a strict audit
identity evaluator. No application feature, database migration or package/lock
change is included. The old Bash-extraction tests move to executable Node tests
against real temporary Git histories and the actual Actions metadata script.

The audit evaluator is groundwork, not a claim that the real consent/privacy,
feedback and roster audits run in CI. Their separate integration prerequisites
and exact execution contract are in `docs/release/audit-contract.md`. Current
main lacks the feedback storage feature required by FS7/FS8. No historical count
was promoted to a current baseline, and no missing audit is a passing check.

## Local verification

- `node --test tests/governance/*.test.mjs`: **69 passed**. Cases include actual
  ordinary/squash/two-commit rebase histories, unmerged dependencies versus shared
  main history, current-head migration order approval, stale/revoked approvals,
  incomplete API evidence, forced/non-forward/stale releases, shallow clone
  rejection, event-head mismatch, a bad merge retaining a path but discarding its
  reviewed contents, and a same-count substitution of audit failures.
- `npm test`: **315 passed**. Five obsolete inline-Bash tests were replaced by
  the stronger policy/workflow tests above; the new policy rejects every non-main
  target instead of allowing a warning-only live stack.
- `npm run test:harness`: **17 passed**.
- `npm run test:db` and `npm run test:db -- --parent-upgrade-review`: **62
  migrations** each; parent invitation assertions and **282 operational-view
  assertions** pass in each order.
- `npm run typecheck` and `npm run build`: pass. Build reports existing large
  chunks. `npm run lint`: **0 errors, 136 warnings**.
- `npm run uc:check`: exits successfully for **2 enforced** use cases. The
  existing pending UC-A02 player-log tests have **3 failures**; **15 pending**
  use cases have no tests. These are not reported as passing journeys.
- `npx playwright test --config playwright.pilot.config.ts`: **5 passed**,
  11.4 seconds, existing local mocked Supabase fixtures. The initial sandbox
  listener restriction and absent default browser executable were resolved by
  running the localhost server with the installed Chromium executable; no app
  fix or hosted account/data change was involved.
- Read-only execution of the actual delivery CLI against already-merged #41:
  passes for result `00910940f596d9fe9a7cd416dc741943d1df2cc9`, including
  all **16 changed-file objects**. This verifies the guard against real GitHub
  metadata without merging or deploying anything.
- `git diff --check`: pass.

Two independent agent reviews found issues that were fixed before publication:
stale event/head binding, missing final-main refresh, forced historical reset,
and shallow-checkout ancestry. Their regression cases are retained. Agent review
does not replace Kostas/Tarek's required independent human approval.

## Migration fact-check and limits

The earlier read-only live check found `20260918070209` applied and
`20260918062345` absent. 070209 changes access settings on existing reporting
views; it does not create them. 062345 does not remove/rename their existing
columns. Source inspection does not establish the alleged unavoidable inversion
break; a future release still needs a disposable replay of its actual upgrade
order. This governance candidate changes neither migration.

An evidence URL is checked for repository, exact candidate SHA and successful
Actions conclusion. A reviewer must inspect the actual migration-order proof.
Delivery verifies the actual merge result and exact reviewed file objects, not
every intended behavior. Candidate-owned policy code relies on protected independent review.
Settings in the prepared JSON are not active protection until an authorized
administrator applies and verifies them. No production enforcement, merged
delivery, deployment or live application outcome is claimed by these local tests.

## Queue integration

For #34/#36/#37/#38, merge/rebase the settled governance main before resolving CI
conflicts; preserve current checks and add only each task's reviewed test steps
with their actual runner/dependency files. Do not replace the workflow wholesale
with an older blob. #36/#37 currently contain #34 and need it delivered first or
an explicitly reviewed restructuring. The general suite-discovery/package-script
refactor is deliberately excluded.

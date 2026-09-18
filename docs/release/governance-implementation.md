# Governance implementation acceptance

Candidate starts at canonical `00910940f596d9fe9a7cd416dc741943d1df2cc9`.
Work is fork-first on `shared/merge-guardrails`. No application features,
historical migration edits, hosted fixtures, production deployment or repository
setting changes are part of this implementation.

## Focused guardrails candidate

- Extend the existing merge-base workflow. Reject non-main targets, stale
  candidates and unmerged dependencies; shared main history must remain valid.
- Compare migration files with current main. Reject edits/deletions of existing
  migrations. Older additions require exact order evidence and an independent
  approval of this candidate and current base; author acknowledgement alone fails.
- Verify delivery using GitHub's actual merge result and exact reviewed file objects.
  Original-head ancestry is not required for squash/rebase merges. Run source
  checks on the delivered commit before the existing production jobs.
- Replace the old inline-Bash extraction tests with executable Node tests of
  the new guard and workflow contract. Main remains valid; every non-main base
  is now rejected, including the formerly warning-only live stack.
- Preserve existing CI and technical agent guidance. Centralize release policy,
  add review routing and a PR template, and prepare matching protection settings.
- Provide an assertion-identity audit evaluator. Known failures cannot hide new
  ones, missing tests, failed controls, skipped tests or runner errors. Historical
  audit totals must not be relabelled as a current-main baseline.

## Verification

Use temporary Git repositories and synthetic GitHub responses to exercise the
actual command paths. Prove both rejection and acceptance: real dependency,
independent branches, already delivered dependency, backdated migration, forged
or stale acknowledgement, authorized order evidence, ordinary/squash/rebase
delivery, wrong target, missing changed file, discarded file contents, missing API data, and a new audit
failure offset by a repaired old failure. Preserve all existing source, harness,
SQL, browser, typecheck, lint and build checks. Inspect actual fork CI before
requesting independent review.

## Separate audit integration

The existing consent, roster and feedback audits are not interchangeable runner
outputs. Integrate their real assertions separately and establish reviewed
baselines on an exact candidate. Repair roster role/positive-control weaknesses;
keep feedback's PostgreSQL concurrency test. The feedback feature is not on this
main revision, so do not manufacture passing/skipped results or expected failures
for its missing schema. No real-child readiness claim follows from a debt baseline.

## Activation and rollback

An administrator must separately approve and activate the documented protection
configuration after the checks exist. Check names and required-review behavior
must be verified from GitHub, including a deliberately failing candidate. A JSON
file in the repository is not active protection. Production changes require
Imad's approval and independent review.

If a guard has a defect, repair it in a reviewed forward PR and retain the manual
release gate in the meantime. Do not bypass controls by force-pushing main,
renaming applied migrations, weakening audit expectations or treating a skipped
check as success. This change has no database rollback.

# Merge and delivery process

Imad's decision, 19 October 2026 (TRAK-205). This replaces the previous
per-commit, independent-approval and Verifying/FINAL OK process, including
routine emergency-fix review requirements. The same automated gate applies to
all final candidates; launch/admission decisions remain in MVP Requirements.

## Branch work

Work, commit and push freely on your own task branch or fork. Local tests are
optional tools for diagnosing a change, not a prerequisite to committing,
opening a draft PR, or completing implementation. Generic skill instructions
for per-increment verification and extra review agents do not add gates here.

Keep the issue key and journey/guarantee or operations purpose in the PR title.
Give the PR a short behavior summary, issue link and known limits. Coordinate
actual file or schema collisions; routine work needs no teammate permission.
Preserve existing migration history and the product's consent/privacy rules.

## One automated gate before merging to main

1. Keep a PR draft while work continues. Mark it ready when the candidate is
   complete and targets current main.
2. GitHub runs `test` (the full lint, types, source, use-case, database, build,
   credential and browser suite) and `Base branch still reaches main`.
3. Fix failures within this gate. A changed final candidate needs fresh results;
   unchanged contents do not need another local or independent verification run.
4. Merge only with required checks green and current main included. No human,
   teammate, code-owner, non-author or additional agent approval is required.
   Authors may merge their own PR. Honor explicit merge holds.

Branch pushes and draft PRs do not run the required regression suite. A PR
changed back to draft stops its in-flight gate. There is no second approval
stage, mandatory review verdict, or requirement to prove every test red first.
Keep meaningful regression coverage for changed behavior in the final suite.

Main remains protected: no direct pushes, force pushes or deletion; required
checks and resolved blocking conversations stay enforced. The intended settings
are in [main-branch-protection.json](main-branch-protection.json). Required PR
approvals are zero and code-owner approval is off, while PRs remain required.
Editing that file does not change GitHub settings: a repo
administrator must apply it. Until then, GitHub may still require an approval;
that is an outstanding settings change, not a renewed team process requirement.

## Credential protection at push

This repository is public. `.husky/pre-push` scans outgoing commit history for
the project's known credentials and password literals, including a value that
was added and removed before push. It runs no feature regression suite.
Keep GitHub secret scanning and push protection enabled as the server-side
guard. A credential rejection requires removing the value from outgoing
history; never bypass it or paste the value into evidence.

## Deployment reuses the tested result

The successful final PR test job records its Git tree (the exact file contents)
and immutable run/attempt identity in a short-lived artifact. On a main push,
`Reuse tested merge` checks the merged PR, successful test job and that artifact
against main's tree. Missing, expired, failed or different evidence blocks
deployment. This handles merge, squash and rebase commits without retesting the
same contents. Expired evidence requires a fresh final PR gate.

After that check, the canonical workflow deploys pending migrations and edge
functions, then the frontend. Backend failure blocks frontend deployment. Fork
CI cannot deploy production. Both automatic Git integrations remain disabled;
previews share production's backend, so never apply development SQL there.
Wait for the active schema deployment before starting the next schema merge.

Report implementation, merge and deployment separately. A successful CI test
is not proof that a feature worked on a real phone or inbox. Deployment failures
get a new linked incident/bug issue rather than reopening completed work.

## Linear completion and live feedback

Use **Todo → In Progress → Done** for implementation. Triage and Backlog remain
available for unstarted work. Mark Done as soon as implementation is complete,
including a completed PR awaiting the gate or merge. One short completion note
records the result, PR/commit and remaining merge/deployment status.

Verifying and mandatory final sign-off are retired. Live testing follows
implementation and deployment; it does not keep the original feature open.
If it fails, create a **new related bug issue**: observed versus expected,
minimal reproduction, relevant build/device, acceptance and original issue/PR.
Keep the original issue Done and link the bug. Do not copy its entire comment
history. A completed issue is not a claim of live verification or pilot admission.

Read the current issue description first. Retrieve only comments and references
needed for a concrete unresolved question. Keep the description current instead
of requiring the next agent to reconstruct decisions from a long thread.

## Incidents and recovery

Pause affected scope/admissions for a consent bypass, wrong recipient or
cross-child disclosure. Record a new incident issue without personal data.
Preserve which migrations actually applied; a frontend rollback does not undo
database changes. Use [the pilot runbook](../pilot-runbook.md) and
[restore runbook](s5-restore-rehearsal.md) for recovery. The incident restart and
real-child admission decisions are separate from routine code approval.

# K1/K2 departure review — unresolved

Reviewed September 18, 2026. Six authorization/data-integrity findings remain after K1/K2. This document and its regression suite are review evidence, **not fixes or deployment approval**. No shared Supabase database was queried or modified during this review.

## Baselines and scope

- Canonical repository: `kostasanastasioubusiness-lang/trak-football-hub`.
- K1/K2 implementation: [`6875968732131706b33d8e1a45a0419ed94fdee7`](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/commit/6875968732131706b33d8e1a45a0419ed94fdee7), merged through PR25 (`bb9aec4`).
- Audited branch: `claude/kind-heisenberg-zvx61c`, [`4f5dd99f3d590a31f0ec9407a3bcbb0a1591bee2`](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/commit/4f5dd99f3d590a31f0ec9407a3bcbb0a1591bee2). Its 53 migrations include K1/K2.
- Canonical main observed: `76683408ebdc37813f6d04c43a3326c5c6467aa9`, with the same 53 SQL migrations. PR26's remaining diff at review time was only `CoachSquadPage.tsx`; the findings below concern the already-merged K1/K2 protection, not new security regressions introduced by that UI diff.
- Compatibility replay: those 53 migrations plus `20260917205027_secure_parent_invites.sql` (P1). The parent-invitation security suite passed. The combined local integration baseline before this review artifact was `ae96f721d082077758e8c33af5e86b7b77862c74`.

## Run the separate regression audit

From the repository root, with lockfile dependencies installed:

```sh
npm run test:db -- --coach-departure-review
```

This explicit audit target is separate from the default passing parent-invitation suite while these findings are unresolved. It must pass before academy-isolation pilot sign-off, and the corrected suite should join required CI with the fixes. It creates an in-memory PGlite database, replays the real migrations and runs [coach_departure_review.sql](../../supabase/tests/coach_departure_review.sql). The fixtures require the disposable-connection marker from [bootstrap.sql](../../supabase/tests/bootstrap.sql). Never run this file against the shared project or a database containing real identities.

**Expected on the reviewed code: exit 1**, reporting:

```text
UNRESOLVED coach departure review: 15 desired assertions failed across 6 finding IDs.
```

Every assertion describes the required safe behavior. An unauthorized write succeeding is a failure; vulnerable behavior is never asserted as a passing expectation. The SQL collects all six finding IDs before raising its aggregate exception. Unexpected SQL errors are not accepted as authorization denial. Positive controls check legitimate coach access before removal and the roster-level isolation that K2 already provides.

The fixture transaction rolls back on success. On the expected exception, the disposable runner must roll back or close its in-memory database. An independent full-replay run explicitly rolled back and confirmed **zero remaining synthetic review Auth users**. Do not convert this audit's expected nonzero exit into a green release check; it remains unresolved until a reviewed fix makes the desired assertions pass.

## Findings and reproduction paths

All six were executed using synthetic fixtures and real `authenticated` role switching, grants, RLS, triggers and RPCs. Adult dates of birth deliberately separate these checks from the under-18 consent work. The same authorization defects affect linked minor records where the separate consent gate permits the operation.

| ID | Priority | Reproduction and observed failure | Desired behavior / source |
|---|---|---|---|
| F1 | P1 | Coach A is removed from academy A and joins B. B's admin cannot read A's roster rows, but can read both former players' `profiles` and `player_details`, including dates of birth. | Profile access must follow stable academy relationships. `player_in_my_org()` still joins through the coach's **current** organization: [original helper](../../supabase/migrations/20260609000001_fix_rls_recursion.sql), lines 24–35, consumed by policies at 73–90. K2 lines 229–243 replace only the roster helper. |
| F2 | P1 | A valid archived roster row survives `remove_coach_from_org()`. The removed coach reads it and inserts an assessment. After joining B, the coach inserts another assessment about that A player; B's admin can read the new assessment. | Removal must revoke all former-academy player authority, including archived/released states. [K2](../../supabase/migrations/20260917000002_coach_departure_and_transfer.sql) line 57 rejects only `coach_departed`; lines 155–159 mark only `active`. [K1](../../supabase/migrations/20260917000001_coach_write_ownership.sql) lines 112–114 stamp the coach's current academy. |
| F3 | P1 | After removal and transfer, the coach directly inserts a new active roster row using the known former player's `linked_player_id`, then creates an assessment for it. Both writes succeed. | A user UUID must not establish a new coaching relationship. K2 lines 84–87 check ownership of the newly created row but do not authorize its linked player. Tests exercise both the unauthorized relationship and the resulting write. |
| F4 | P1 | After removal, the coach reads attendance for both former players and deletes the active player's old attendance row. | Keeping a coach's session diary must not retain child attendance access. [Existing attendance SELECT/DELETE policies](../../supabase/migrations/20260526000002_rls_explicit_operations.sql), lines 131–138 and 158–165, check session ownership only. K1 modifies INSERT/UPDATE; K2's lines 104–110 incorrectly state that attendance becomes inaccessible. |
| F5 | P1 | After removal, the coach successfully calls `log_match_for_player()` for the departed player. A new `matches` record is present. | The RPC must enforce current authorized coaching relationships. [Match RPC](../../supabase/migrations/20260901000002_pilot_measurement_columns.sql), lines 118–124, checks retained ownership IDs without departure status or academy membership. |
| F6 | P2 | The original prototype deleted an academy admin after committing fixtures: deletion succeeded, but a roster row retained a nonexistent organization UUID. The portable transaction-based suite instead raises a foreign-key violation and prevents the admin deletion. | Deletion must complete while preserving the roster with a null organization reference. K2's `ON DELETE SET NULL` at line 173 conflicts with the unconditional pin at lines 204–205. Both observed execution contexts violate that contract. The portable test catches the FK failure as F6, then checks deletion and reference cleanup. |

F1–F5 are incomplete closure of existing vulnerabilities, not claims that K1/K2 newly introduced each vulnerability. F6 is a newly introduced interaction between organization pinning and foreign-key cleanup. The initial prototype also confirmed that a coach can set their own row to `archived` before removal; the portable fixture starts with that valid lifecycle state to cover existing archived records directly.

## Follow-up acceptance criteria

Kostas owns the K1/K2 implementation. A coordinated forward migration should cover stable academy membership across every child-facing policy/RPC, all roster lifecycle states, authorized linking, attendance operations and referential actions. Do not repair this by hiding controls only in the UI or rewriting deployed migrations.

Before closing the review:

1. Make this audit pass without removing the desired assertions or weakening legitimate-access controls. Add coverage for `released`, direct academy transfer without a prior removal RPC, and existing-session access.
2. Keep P1's separate SQL suite passing; parent links should not be revoked merely because a coach departs.
3. Verify account deletion with committed fixtures as well as one-transaction fixtures, including assessment/award organization references and every account role. The similar K1 organization-pinning trigger on assessments/awards was identified statically but was not separately reproduced here.
4. Obtain peer review, deploy through the release gate, then verify with designated synthetic users on the actual platform. Record that evidence separately.

PGlite provides executable PostgreSQL evidence, not proof of Supabase Auth HTTP behavior, live grants/configuration, concurrent connections or deployment state. This review did not verify live behavior or claim the pilot isolation/deletion gates are satisfied.

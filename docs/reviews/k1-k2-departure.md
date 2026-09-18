# K1/K2 departure review and regressions

Reviewed September 18, 2026. The original six findings below describe the initial K1/K2 baseline. Subsequent upstream and fork changes are recorded separately here; this document is **not deployment or pilot approval**. No shared Supabase database was modified during this work.

## Main refresh

The [September 18 refresh onto main `0091094`](academy-main-0091094-refresh.md) records current 63-migration fresh and upgrade replays. The academy migration and original SQL fixtures are unchanged. Counts and advisor observations below describe the earlier snapshots explicitly named here, not the refreshed or live system.

## Earlier follow-up

On upstream `ff9d713` plus the P1 migration, all 58 migrations replay and F2–F5 now pass. The original audit still fails five desired assertions across F1/F6. The new fork migration `20260918062345_preserve_academy_access_and_fk_cleanup.sql` addresses those failures and the linked-roster UPDATE regression introduced in migration `00004`.

- Player profile/DOB access follows the roster's recorded academy and requires a player target, preserving the original academy's access without revealing records to the transferred coach's new academy.
- Organization pinning permits real FK cleanup only when the referenced academy no longer exists. Existing orphan references are repaired without assigning them to a new academy.
- Deleted-academy rows carry a permanent `organization_deleted_at` marker. Later updates cannot clear it, reactivate the row, reassign its academy or link a new player to closed history. The linking RPC excludes departed/deleted/foreign-academy rows and requires a player caller; a genuine independent roster can still be adopted.
- Coaches can edit an unchanged legitimate player link. The self-link trigger still rejects assigning another player's UUID.

Independent review caught a bypass in the first local patch: deleting an academy marked a stub departed, but the existing name-adoption RPC could reactivate it and restore coach access. The permanent marker and actual RPC regression address that lifecycle path; merely passing the original six assertions was insufficient.

The updated 59-migration replay passes the original audit, academy-access compatibility cases, and 78 committed four-role deletion assertions. The default parent-invitation suite also passes. CI now runs both suites. The negative control `npm run test:db -- --coach-departure-baseline` remains red on the vulnerable 58-migration snapshot.

The same 59 migrations, backfill assertions and all five SQL suite files also passed on a private PostgreSQL 17.11 cluster on September 18. A separate two-connection test reproduced duplicate roster rows from simultaneous calls by the same player, both with an empty roster and an existing stub. The new RPC serializes each verified player/coach pair with a transaction advisory lock. Both same-player cases now return one identical row ID, preserve existing history and create no duplicates; the distinct-player case returns each caller's own row. The historical RPC negative control still fails both same-player cases. See `npm run test:db:concurrency` and the test README.

The security advisor was run successfully against that disposable cluster but remains **red**: 12 pre-existing owner-privilege reporting views and two unpinned pure functions are reported. These are being repaired separately; the advisor failure is not suppressed. The native runner's initial Node PATH failure has its own passing regression test. Every temporary cluster was stopped and removed.

Independent re-review also reran the deleted-academy/name-adoption attack and later attempted marker/academy reassignments; the former coach and new academy remained denied. This is technical review, not the required human approval. PostgreSQL 17 is the deployed major version, but these tests are not evidence from the live Supabase project or its exact patch/build. They do not establish general load capacity, all possible concurrency paths, HTTP Auth or live deletion. Name-plus-coach-code adoption still does not prove a real-world child's identity. [Remaining account-deletion findings](account-deletion-followups.md) keep full U10 open. Peer review, deployment and live synthetic-role verification remain required.

## Baselines and scope

- Canonical repository: `kostasanastasioubusiness-lang/trak-football-hub`.
- K1/K2 implementation: [`6875968732131706b33d8e1a45a0419ed94fdee7`](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/commit/6875968732131706b33d8e1a45a0419ed94fdee7), merged through PR25 (`bb9aec4`).
- Audited branch: `claude/kind-heisenberg-zvx61c`, [`4f5dd99f3d590a31f0ec9407a3bcbb0a1591bee2`](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/commit/4f5dd99f3d590a31f0ec9407a3bcbb0a1591bee2). Its 53 migrations include K1/K2.
- Canonical main observed: `76683408ebdc37813f6d04c43a3326c5c6467aa9`, with the same 53 SQL migrations. PR26's remaining diff at review time was only `CoachSquadPage.tsx`; the findings below concern the already-merged K1/K2 protection, not new security regressions introduced by that UI diff.
- Compatibility replay: those 53 migrations plus `20260917205027_secure_parent_invites.sql` (P1). The parent-invitation security suite passed. The combined local integration baseline before this review artifact was `ae96f721d082077758e8c33af5e86b7b77862c74`.

## Run the regression audit

From the repository root, with lockfile dependencies installed:

```sh
npm run test:db -- --coach-departure-review
```

This target is separate from the default parent-invitation suite and required in CI alongside it. It creates an in-memory PGlite database, replays the real migrations and runs [coach_departure_review.sql](../../supabase/tests/coach_departure_review.sql), academy compatibility and committed deletion fixtures. The fixtures require the disposable-connection marker from [bootstrap.sql](../../supabase/tests/bootstrap.sql). Never run these files against the shared project or a database containing real identities.

**Historical result on the original reviewed code: exit 1**, reporting:

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

## Original follow-up acceptance criteria

Kostas owns the initial K1/K2 implementation and F2–F5 follow-ups. Imad/Codex reserved the F1/F6 forward migration and regressions in `#coding-agent-reviews`. The original criteria remain useful: stable academy membership across child-facing policies/RPCs, all roster lifecycle states, authorized linking, attendance operations and referential actions. Do not repair this by hiding controls only in the UI or rewriting deployed migrations.

Before closing the review:

1. Make this audit pass without removing the desired assertions or weakening legitimate-access controls. Add coverage for `released`, direct academy transfer without a prior removal RPC, and existing-session access.
2. Keep P1's separate SQL suite passing; parent links should not be revoked merely because a coach departs.
3. Verify account deletion with committed fixtures as well as one-transaction fixtures, including assessment/award organization references and every account role. The original audit identified assessment/award pinning statically; the new committed fixtures execute that failure and its repair.
4. Obtain peer review, deploy through the release gate, then verify with designated synthetic users on the actual platform. Record that evidence separately.

PGlite provides executable PostgreSQL evidence, not proof of Supabase Auth HTTP behavior, live grants/configuration, concurrent connections or deployment state. This review did not verify live behavior or claim the pilot isolation/deletion gates are satisfied.

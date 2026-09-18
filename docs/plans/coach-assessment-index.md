# Coach assessment date index

Scope: one additive B-tree on `coach_assessments(coach_user_id, created_at DESC)`, supporting the routed Home latest-five feed. Leave policies, grants, RPCs, existing indexes, field projections and application behavior unchanged. Squad latest-per-player and Home analytics history need separate K7 work; this index does not bound either request.

Existing date-only ordering does not define a winner for identical timestamps. A different plan can return different tied rows at a LIMIT boundary. The benchmark uses distinct fixture timestamps for exact result comparison; it does not prove deterministic ties. A stable secondary sort key needs coordinated caller/index work separately.

Evidence: the [query investigation](../reviews/coach-query-performance.md) identifies a coach-filtered scan/sort. The proposed index was exercised in disposable PGlite and native PostgreSQL 17 with 31,100 synthetic assessments. Native results were identical before/after, and five independently connected read clients returned identical rows with observed execution overlap.

Acceptance before review:

1. Generate a new migration with the Supabase CLI; do not rewrite history.
2. Replay every migration and existing database access tests. Inspect the database advisor.
3. In a private native cluster, remove only this new index for the baseline and apply the actual migration for the comparison. Check index definition/usage, identical complete results, and authenticated caller identity. Preserve plans; do not use flaky elapsed-time thresholds.
4. Run the relevant runner/unit/lint checks and fork CI. No hosted operation is part of implementation.

Rollout: human review, merge through Imad and the normal migration deployment gate. Normal index creation takes a table lock blocking writes while building; measure size and schedule the reviewed release accordingly. A short local build is not a production lock-duration guarantee. No existing index is removed, so this also adds storage and write-maintenance overhead. If deployment needs correction, use a new forward migration to remove only the added index; keep all security migrations and history. The full-history application queries remain follow-up work.

# S5 — restore rehearsal

Owner: Kostas. Status: **not yet executed.** This document is the procedure and the evidence
template. It is not evidence that a restore works.

`docs/pilot-readiness-2026-09-25.md` lists, among the gates that must pass before a real child
signs up: *"Restore rehearsal evidence and duration (Kostas S5), not merely an available backup."*
Eight completed physical backups exist (Imad, read-only in the production dashboard, 22 Sep, latest
`2026-09-22 05:50:03 UTC`; PITR is **not** enabled). **That fact does not close S5.** What closes
S5 is a measured recovery: how long it takes to get `trakfootball.com` serving correct data again,
and what does not come back.

## What this rehearsal is actually measuring

A physical backup restores **one Postgres database into a new Supabase project**. It does not
restore a service. The restored project has a **new project ref**, and that ref is hard-coded in
**nine files** outside documentation, plus the platform configuration. So the recovery clock is
dominated by a code change and a CI deploy, not by the restore.

Measure the whole thing or the number is meaningless. `T0` is the decision to restore; `T_done` is
a designated synthetic account completing a real journey on `trakfootball.com` against the restored
backend.

## Production pre-state

Read-only, measured by Kostas on **2026-09-22 ~19:20 EEST** against `xbykbqolvqyqmipikuae`
(`eu-central-1`, PostgreSQL 17.6, 15 MB). No writes were made. Re-measure immediately before a
restore rather than trusting these; they are here so the verification step has something to compare
against and so a silently empty restore cannot read as success.

| | |
|---|---|
| migrations applied | **83**, latest `20260921120000` |
| `auth.users` | 36 |
| RLS | **24 of 24** public tables, 97 policies |
| `SECURITY DEFINER` functions in `public` | 48 |
| extensions | `pg_stat_statements` 1.11, `pgcrypto` 1.3, `uuid-ossp` 1.1, `supabase_vault` 0.3.1, `plpgsql` 1.0 |
| non-system schemas | `auth, extensions, graphql, graphql_public, public, realtime, storage, supabase_migrations, vault` |
| storage | bucket `avatars` (`public=false`), **2 objects** |
| edge functions | 4 ACTIVE — `coach-assistant`, `parse-schedule`, `player-feedback`, `send-parent-invite` |

Row counts, largest first:

```
telemetry_events 558 · session_attendance 146 · coach_assessments 135 · matches 89
squad_players 73 · profiles 35 · coach_calendar_events 20 · player_details 16
coach_sessions 10 · recognition_awards 10 · coach_assessment_notes 9 · coach_details 8
parent_invites 8 · player_parent_links 7 · ai_usage_daily 3 · organizations 2
parental_consents 1 · pilot_config 1
admin_notes 0 · ai_feedback_drafts 0 · coach_shared_feedback 0 · meeting_requests 0
player_feedback 0 · staff_compliance 0
```

Two things in that snapshot are worth naming rather than leaving in a table. `trak_private` does
not exist yet, so #99 is not deployed. And the live storage policy is still
`"Avatars are publicly readable" FOR SELECT` — the Monday exposure, open at the time of writing.

## What a restore does NOT bring back

This is the part S5 exists to establish, and the part that a "we have backups" answer hides.

1. **Storage objects are excluded from the physical backup.** Avatars are not recovered. Today
   that is 2 synthetic objects. From Monday it is real children's photographs, and a restore would
   silently produce profiles whose `avatar_url` points at objects that no longer exist — the
   dangling case `scripts/ops/purge-avatar-object.mjs` reports. **There is currently no backup of
   the `avatars` bucket at all.** That is a separate gap from S5 and it is not closed by this
   procedure.
2. **Edge functions are not in a database backup.** All four are in the repository and redeploy
   from CI, so this costs a pipeline run, not authorship.
3. **Edge function secrets are not in a backup and are not in the repository.** `LOVABLE_API_KEY`
   and `SITE_URL` must be set by hand on the restored project. The `SUPABASE_*` variables are
   injected by the platform.
4. **Auth configuration is not in a backup.** The redirect allow-list must be re-created, including
   the exact `https://www.trakfootball.com/reset-password` entry that #102's recovery flow depends
   on — Tarek probed that allow-list on 22 Sep and a fallback-to-root link does not work, so a
   missing entry locks every parent out of password recovery. Email templates are set by hand and
   are not deployed by CI.
5. **A new project has new JWT keys.** Every session issued by the old project is dead: everyone is
   signed out, and `VITE_SUPABASE_PUBLISHABLE_KEY` changes.
6. **PITR is not enabled**, so the recovery point is the last daily physical backup, not the moment
   before the incident. Any writes since then are lost. Decide whether that is acceptable for a
   live pilot *before* Monday, not during an incident.

## Where the project ref is hard-coded

`grep -rl xbykbqolvqyqmipikuae` finds nine files outside documentation, on 22 Sep. A restored
project has a different ref. Until these change, the app does not work — and the first one fails in
a way that looks like a network problem rather than a configuration one.

| Where | What breaks if it is not changed |
|---|---|
| `vercel.json` — CSP `connect-src` **and** `img-src` | **Every request to the new backend is blocked by the browser.** This is the trap: the app loads, and nothing works. |
| `src/integrations/supabase/client.ts` | Hardcoded fallback URL, used whenever `VITE_SUPABASE_URL` is absent |
| Vercel env `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Must be **Config, not Secret**, or the build ships placeholders — this has already bitten us once |
| GitHub secrets `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL` | CI's migration push and `functions deploy` still target the old project |
| `supabase/config.toml` `project_id` | Local CLI only. CI passes `--project-ref "$PROJECT_ID"` explicitly and deliberately does not `supabase link`, so CI is repointed by the two GitHub secrets above, **not** by this file. |
| `e2e/parent-consent.spec.ts`, `e2e/parent-family.spec.ts`, `e2e/parent-invitation.spec.ts` | Specs abort requests to any other origin, so they fail closed |
| `seed-admin-data.mjs` | Seeds against whatever it names; check before running it anywhere |
| `src/lib/__tests__/avatar-url.test.ts`, `src/lib/__tests__/avatar-object-path-mirror.test.ts` | Fixtures only; harmless |

## Decision point — this costs money

Imad quoted restore-to-new-project on the latest backup at **$10.18/month additional** ($9.68
compute + $0.50 disk), same organisation, Frankfurt, initial disk 1.5×. He cancelled without
starting. **Nobody starts a restore without Kostas saying so**, and the restored project is deleted
at the end of the rehearsal so the charge does not recur.

Do not restore into `trak-football-test` (`vklpncpwenulmjilnxuj`) — it holds Imad's isolated
rehearsal fixtures and is in active use.

## Procedure

Record wall-clock at every marker. Estimates are deliberately absent: producing the real numbers is
the deliverable.

| # | Step | Marker |
|---|---|---|
| 0 | Re-measure the pre-state above against production, read-only. Save the output. | `T0` |
| 1 | Dashboard → Database → Backups → restore the latest physical backup **to a new project**. Note the chosen backup's timestamp. | `T_restore_start` |
| 2 | Wait for the new project to reach `ACTIVE_HEALTHY`. Note its ref and Postgres patch version. | `T_db_ready` |
| 3 | Run the verification queries below against the restored project. | `T_db_verified` |
| 4 | Set `LOVABLE_API_KEY` and `SITE_URL` on the restored project; re-create the auth redirect allow-list including `/reset-password`. | |
| 5 | Point CI at it: `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL`. Deploy the four edge functions. | `T_functions_ready` |
| 6 | Change the ref in `vercel.json` (both CSP directives) and `src/integrations/supabase/client.ts`; set the two `VITE_` variables in Vercel as **Config**; deploy. | `T_frontend_deployed` |
| 7 | Sign in as a designated synthetic account and complete one real journey — coach logs an assessment, player reads it. | **`T_done`** |
| 8 | Delete the restored project. Confirm the charge does not recur. Restore the repository changes from step 6. | |

### Step 3 verification

Compare against the step-0 snapshot, not against this document.

```sql
-- migrations: expect the same count and latest version as production
SELECT count(*), max(version) FROM supabase_migrations.schema_migrations;

-- RLS must have survived: expect 24 of 24, and the same policy count
SELECT count(*) FILTER (WHERE c.relrowsecurity) AS rls_on, count(*) AS tables
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef;

-- row counts, table by table
SELECT c.relname,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                           false, true, '')))[1]::text::bigint AS rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2 DESC, 1;

-- expected to be EMPTY or absent: the bucket's bytes are not in the backup
SELECT count(*) FROM storage.objects;
```

A row-count match is not sufficient on its own. **Run the access tests as authenticated roles**,
because a restore that loses a policy produces correct counts and wrong permissions, and the
readiness document is explicit that inspecting SQL text does not prove isolation. At minimum,
confirm as a signed-in player that `coach_assessment_notes` is unreadable and that another
academy's `squad_players` are invisible.

## Evidence record — fill in on execution

Per `docs/pilot-readiness-2026-09-25.md`: name commit/workflow, deployment, role/test identity,
device, expected/observed outcome, and limitations.

```
Executed by:            (must not be the only reviewer — S5 needs a non-author verdict)
Date/time (UTC):
Backup restored:        timestamp ............  chosen because ............
Source project:         xbykbqolvqyqmipikuae
Restored project ref:                          Postgres patch:
T0 → T_db_ready:                               (restore alone)
T0 → T_done:                                   (ACTUAL RECOVERY TIME — this is the S5 number)
Data loss window:       last backup → incident = ............
Verification:           migrations ___/83 · RLS ___/24 · policies ___/97 · definer fns ___/48
                        row counts match: yes / no — differences:
                        authenticated access tests: ............
Storage objects:        expected 0 recovered — observed:
Not recovered:          avatars bucket · auth config · function secrets · sessions
Cost incurred:                                 Project deleted at:
Limitations:
```

## What would make this unnecessary to rehearse twice

Nothing here removes the need to execute it once. But two of the six gaps above are fixable rather
than merely documented, and both are cheaper than a restore: an export of the `avatars` bucket
(item 1), and enabling PITR (item 6) so the recovery point is not up to 24 hours old. Both are
decisions for Kostas with a cost attached, and neither is in this release's scope.

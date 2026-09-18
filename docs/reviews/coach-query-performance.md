# Coach assessment query performance — synthetic investigation

The additive coach/date index is implemented for review in `20260918080430_index_coach_assessment_history.sql`. It improves the bounded recent-assessment feed; the unbounded squad/Home analytics histories remain separate work. No production change was made. The [scope and rollout plan](../plans/coach-assessment-index.md) records lock/storage costs and the existing timestamp-tie limitation.

## Refreshed native verification

The [main/PR34 refresh evidence](query-main-0091094-refresh.md) records the current 64-migration upgrade and fresh replay, including actual authenticated result/policy comparisons. The earlier 61-migration measurements and advisor observation below are historical; they are not a fresh or live result.

## Earlier native verification of the actual migration

September 18, 2026: `node scripts/test-query-performance.mjs` used PostgreSQL 17.11 in a private Unix-socket cluster with no TCP listener. It replayed all 61 migrations and existing sequential security suites, then created 20 synthetic academies/admins/coaches, 600 linked adult players (DOB 2000-01-01), 600 academy-pinned roster rows and 31,100 assessments. Additional sequential-suite fixtures remained: 604 total roster rows and 31,104 assessments. It removed only the new index for the baseline, then applied the actual migration file.

| SQL query | Before ms / shared hits | After ms / shared hits |
|---|---:|---:|
| Home latest-five, all assessment fields plus player-name join | 71.179 / 23,006 | 2.598 / 2,135 (+2 reads) |
| Squad full history, 2,600 returned rows | 77.600 / 22,991 | 74.501 / 22,991 |
| Home full analytics history, 2,600 rows | 70.414 / 22,991 | 72.337 / 22,991 |
| Proposed latest-per-player, 30 rows (not shipped to callers) | 5.473 / 4,159 | 5.088 / 4,159 |

The new index was present in the actual Home query plan. Its local database build took 8.857 ms and occupied 1,277,952 bytes; neither is a production forecast. Complete result rows, fixture fingerprints and RLS policies were identical before/after. The Home feed returned exactly the expected five newest identities/timestamps with populated player names. All captures ran as the actual authenticated coach; no definer bypass was used.

Five distinct PostgreSQL connections ran the Home query in each phase. Execution intervals overlapped in both phases and every result matched the sequential reference. Observed execution ranges were 90.046–101.571 ms before and 2.917–5.510 ms after. These are concurrent reads for the same synthetic coach on one local machine, not an HTTP load test or supported-user capacity. No elapsed-time threshold is asserted.

A separate native replay of all 61 migrations passed the parent invitation, coach departure, academy access, operational views and account-deletion suites. The Supabase database advisor reported **No issues found**, exit 0, against that private socket. Both clusters were stopped and removed. Native helper tests passed 12/12, release-workflow tests 6/6, and focused lint passed.

Full local evidence: `/private/tmp/trak-query-report-G5LRIx/report.json`. The committed runner reproduces the comparison, and CI uploads its synthetic report as `synthetic-assessment-query-plans` with 14-day retention. Results above use distinct fixture timestamps: date-only queries still have unspecified order at ties. Hosted API plans, network payloads, real-device timing and sustained multi-user capacity remain unverified.

## Original PGlite investigation

The following original investigation used integration `c5e8832`, before the index was implemented, and a smaller identity model without academies. Its numbers should not be mixed with the later academy-linked native measurements above.

## Finding

The routed squad screen reads all assessments by the current coach, sorts them newest first, and keeps the first non-null rating for each roster row in JavaScript (`src/pages/coach/CoachSquadPage.tsx:57`). That performs work proportional to assessment history to show one rating per player. The coach Home page separately fetches the full history for analytics (`CoachHomePage.tsx:43`) and a latest-five feed (`CoachHomePage.tsx:54`). These are distinct reads: adding LIMIT 5 to the analytics request would change its meaning and lose data.

There is already an index on `coach_user_id` and another on `(squad_player_id, created_at DESC)`. The current latest-five filter cannot obtain coach-wide date order directly from either. A temporary composite index removed the full-history sort for the measured latest-five shape. It did not fix the unbounded full-history request.

## Executed environment and data

- Disposable in-memory PGlite, with all 60 current migrations replayed in filename order and the repository Supabase platform bootstrap. No network database or credentials. Each measured statement had a 10-second statement timeout; none timed out.
- Actual database role `authenticated`, synthetic coach UUID `95000000-0000-0000-0000-000000000001`; existing RLS policies and helpers remained enabled and unchanged.
- 20 synthetic independent coaches, 30 unlinked roster rows each: 600 roster rows and 31,100 assessments. Each roster row had 50 weekly historical assessments; one row had 1,100 additional recent hourly assessments to stress uneven history. The selected coach had 2,600 assessments across 30 players. This deliberate skew is a test fixture, not a forecast of academy behavior.
- No academy membership, parent link, concurrent load, network, PostgREST JSON serialization, or browser rendering was included. This is a single-process database-plan comparison.

## Measured results

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` reported the following single-run observations. Milliseconds are local PGlite timings, not hosted latency targets; cache warm-up and WASM runtime can affect them. Shared-block hits are repeated cached accesses, not distinct pages or physical disk reads.

| Query | Returned rows | Execution ms | Shared block hits | Plan behavior |
|---|---:|---:|---:|---|
| Current squad projection, uncapped | 2600 | 33.845 | 10,564 | Coach-ID bitmap scan of 2,600 rows, RLS filter, quicksort |
| Same query with an illustrative LIMIT 1000 | 1000 | 30.683 | 10,504 | Same 2,600-row scan and RLS filter, top-N sort |
| Latest-five core filter/order shape | 5 | 29.407 | 10,504 | Same 2,600-row scan and RLS filter, top-N sort |
| Proposed latest-one-per-visible-player query | 30 | 4.557 | 856 | 30 lateral probes using existing squad/date index |
| Latest-five shape with temporary coach/date index | 5 | 0.164 | 23 | Ordered index scan stops after 5 visible rows |
| Illustrative LIMIT 1000 with temporary index | 1000 | 12.167 | 4,024 | Ordered index scan stops after 1,000 visible rows |
| Uncapped query with temporary index | 2600 | 30.323 | 10,504 | Planner still chooses bitmap scan and sort |

The latest-five benchmark uses the squad projection below plus `LIMIT 5`. The routed Home feed actually selects `*` and embeds `squad_players(player_name)`; that wider projection and join were not benchmarked. The measured filter/order bottleneck is shared, but these numbers are not a measurement of the complete Home HTTP request.

The lateral plan used 30 one-row probes on `idx_coach_assessments_squad_created`, but its outer roster read still chose a sequential scan over the 600-row fixture. This is an improvement for the measured history-heavy case, not proof that every part scales independently of total roster size.

The uncapped results covered all 30 players. In the deliberately skewed fixture, an illustrative 1,000-row cap covered only one player; the proposed query returned all 30 and matched every latest timestamp and rating from the uncapped reference. The hosted PostgREST row cap was not inspected, so this demonstrates a cap-dependent correctness risk, not a verified production truncation. A blanket LIMIT on history cannot safely replace latest-per-player selection.

## Actual SQL

Current routed squad projection and ordering, translated directly from the Supabase request:

```sql
SELECT squad_player_id,coach_rating,created_at FROM public.coach_assessments WHERE coach_user_id='95000000-0000-0000-0000-000000000001' ORDER BY created_at DESC;
```

The comparison added `LIMIT 1000` as an explicitly hypothetical API cap and `LIMIT 5` to reproduce the narrow core of the separate latest-five feed.

Proposed query executed under the same authenticated role and unchanged RLS:

```sql
SELECT sp.id AS squad_player_id,a.coach_rating,a.created_at FROM public.squad_players sp LEFT JOIN LATERAL(SELECT ca.coach_rating,ca.created_at FROM public.coach_assessments ca WHERE ca.squad_player_id=sp.id AND ca.coach_user_id=auth.uid() AND ca.coach_rating IS NOT NULL ORDER BY ca.created_at DESC LIMIT 1)a ON true WHERE sp.coach_user_id=auth.uid() ORDER BY sp.player_name;
```

Index applied only inside the disposable database, after collecting the original plans:

```sql
CREATE INDEX perf_coach_created
  ON public.coach_assessments (coach_user_id, created_at DESC);
ANALYZE public.coach_assessments;
```

## Minimal proposed changes and constraints

1. The coach/date index proposal was coordinated in #coding-agent-reviews and implemented/verified as described above. It changes no authorization or query scope and directly helps a bounded latest-five/date-ordered feed. Existing indexes remain. Write-maintenance overhead and production lock duration still require release consideration.
2. Coordinate the squad rating read with K7: expose a bounded latest-per-player result using invoker permissions and the existing squad/date index, then replace only the routed squad history fetch. The tested lateral query preserves the current coach-authored filter, zero scores, newest non-null rating, and unassessed players through a LEFT JOIN. It does not bypass RLS.
3. K7 may intentionally require the latest academy assessment, including retained history from another coach. That product requirement is broader than this performance-only equivalence. Agree the authorized history scope before creating an RPC; do not silently bake the current author filter into the final API. Preserve departed/transferred-coach denials, parent/player isolation, and deleted-academy history protections in regression tests. If exposed as an RPC, prefer SECURITY INVOKER and identity from auth.uid(), never a trusted caller-supplied coach ID.
4. Do not replace the Home analytics history with five rows or just one rating per player. Review its calculations and intended history window separately; a server-side aggregate or paginated history needs correctness tests. Tied timestamps also need a deterministic agreed tie-breaker before a new API contract.

## Other inspected paths

`src/lib/parent-data.ts` already batches child/profile and coach-name reads; assessment and award requests use explicit projections and LIMIT 10 with squad IDs. The existing assessment squad/date index aligns with that query. No parent-data change is proposed from this investigation, and no parent-role plan was measured. Parent matches are unpaginated, as are coach player-profile assessment history and the session list; those are source observations, not separately measured bottlenecks. Coach sessions already have `(coach_user_id, session_date DESC)`.

## Artifacts and limits

Full JSON plans, executed SQL, role, existing indexes, counts, and comparison assertions are retained locally at `/private/tmp/trak-query-performance-results.json`. The temporary investigation script `scripts/_query-performance.local.mjs` was removed after preserving this report. This report contains the durable result summary; the temporary JSON is not a required repository artifact.

The original PGlite study did not include native, hosted, HTTP or concurrent measurements. The later native evidence above adds a narrowly scoped concurrent-read comparison and verifies the implemented index; it does not establish whole-application performance or resolve the remaining unbounded queries.

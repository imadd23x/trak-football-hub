# Trak Academy Pilot — operational reference

Use the [current pilot charter and readiness](pilot-readiness-2026-09-25.md) for
scope and admission gates. `pilot-scope.html` is a superseded single-academy
proposal. The older `pilot-runbook.html` is background reference; its cohort,
dates and deployment assumptions require reconciliation with the reviewed build.
This file contains operational procedures, not authority to deploy, seed shared
data or admit real children. Follow the reviewed release's instructions and the
[merge/deployment gate](release/merge-gate.md) before executing commands.

---

## Deploy order

Historical deployment illustration: the migration subset and eight-week SQL
example below describe the earlier single-academy proposal. They are not a
complete current release sequence or an agreed pilot duration. Use the reviewed
release's full migration/deployment instructions and confirmed academy/window;
do not copy these placeholders into the shared project.

**Migrations first.** `CoachQuickMatchLog` and `CoachAddSession` pass `p_match_date` to
`log_match_for_player`; against the old 15-argument function that call fails and coach match
logging breaks entirely.

```
20260423999999_user_role_club_value.sql        ← dated early on purpose
20260901000001_pilot_telemetry.sql
20260901000002_pilot_measurement_columns.sql
20260901000003_pilot_scorecard_views.sql
20260901000005_pilot_org_scoping.sql
20260901000006_link_player_adopts_roster_row.sql
```

Then set the pilot window and deploy the app:

```sql
UPDATE pilot_config SET starts_on = 'YYYY-MM-DD', weeks = 8, org_id = (SELECT id FROM organizations WHERE name = '<the academy>');
```

**`org_id` is not optional.** Left NULL the cohort views count every squad row and parent
invite in the database — demo academies, dev accounts, old seed data — and activation
becomes meaningless. Verified in rehearsal: 3.2% unscoped, 60% scoped.

## The weekly query

Operational reports are restricted to the authorized operator SQL workflow or a
separate trusted server-side `service_role` connection. This includes every
`pilot_*` report, `squad_duplicate_candidates` and `stale_pending_consent`.
An application's `club` account still uses the `authenticated` database role;
it is not `service_role`. Denial with app credentials is expected, not evidence
that measurement is broken. Never put service credentials in browser `VITE_*`
configuration or substitute them into the legacy seed/check clients.

In the reviewed project's operator SQL editor, verify report access explicitly:

```sql
BEGIN READ ONLY;
SET LOCAL ROLE service_role;
SELECT current_user;
SELECT * FROM public.pilot_scorecard;
ROLLBACK;
```

One row per pilot week: activation, match coverage, assessment rate (H1), median seconds to
assess, rating agreement (H4, derived and blind), player and parent return, safeguarding flags.

For S3, record the target project, deployed migration, querying role, configured
academy/window and observed values. Permission alone does not prove that numbers
are correct. The legacy checker skips these reports; it cannot attest to their
contents or migration state using an application key.

### Drill-downs

Run these reports and the H4 query below through the same authorized workflow.

| Metric | View |
|---|---|
| 1 Activation | `pilot_activation` |
| 2 Match coverage | `pilot_match_coverage` |
| 3 Assessment rate — **H1** | `pilot_assessment_rate` |
| 4 Time to assess | `pilot_time_to_assess` |
| 5 Rating agreement — **H4** | `pilot_rating_agreement_derived`, `pilot_rating_agreement` |
| 6–7 Return by role | `pilot_retention` |
| 8 Safeguarding | `pilot_safeguarding_checks` — **must return zero rows** |

### H4 position-bias check — run weekly from week 1

```sql
SELECT position,
       count(*)                   AS n,
       round(avg(engine_bias), 2) AS avg_bias,
       round(100.0 * count(*) FILTER (WHERE agrees) / count(*), 1) AS agreement_pct
FROM pilot_rating_agreement_derived
GROUP BY position
ORDER BY avg_bias;
```

Negative `avg_bias` means the engine bands **lower** than the coach. A consistent negative for
`gk`/`def` beside a positive for `att` is the systematic bias the scope predicts.

## Rehearsal data

Historical fixture description, not current seed instructions. The invocation,
purge switch and cohort below predate the reviewed S2 workflow. Use the accepted
S2 revision and its explicit target/setup safeguards for synthetic rehearsal;
do not execute this legacy invocation against the shared project. Thirty players
and six weeks of generated fixtures are not confirmed real-pilot commitments.

```bash
node seed-pilot-rehearsal.mjs
```

Two squads, ~30 players, six weeks of fixtures, matches, assessments and awards under
`@rehearsal.trak.dev` / "Rehearsal FC". Reset with `--purge`.

`telemetry_events` stays **empty** after seeding — it is written by the app, not the script. That
is deliberate: metrics 4, 6 and 7 stay blank until you click through the smoke test below.

## Smoke test — the gate on week 0

`trackEvent` fails silently for the user, so a missing table looks exactly like a working one.
Nine event types must appear before the pilot starts; a missing event cannot be backfilled.

| Do this | Event |
|---|---|
| Open the app | `app_opened` |
| One full assessment | `assessment_submitted` (non-null `duration_ms`) |
| Quick-assess 3 players | `quick_assess_completed` (`players: 3`) |
| Build a roster | `roster_built` |
| Log a match | `match_logged` (`actor: 'coach'`) |
| Paste fixtures | `schedule_parsed` |
| Ask the assistant | `assistant_used` |
| As player, open feedback | `feedback_opened` |
| As parent, open alerts | `alert_opened` |

```sql
SELECT event_type, role, count(*), max(created_at)
FROM telemetry_events
GROUP BY 1, 2 ORDER BY 1;
```

In development the console logs `[telemetry] "<event>" failed:` on any write error.

## Duplicate roster rows

Player signup now adopts the coach's own roster entry instead of inserting a second one.
Any duplicates created before that fix are surfaced, not merged:

Use the same authorized operator/service-role workflow as the weekly query.

```sql
SELECT * FROM squad_duplicate_candidates;
```

Merging is a human decision — assessments and awards may hang off either row.

# Trak Academy Pilot — operational reference

The full runbook lives in `docs/pilot-runbook.html` (published as an artifact) and the pilot scope in
`MVP Requirements`. This file carries only the parts you run, so the narrative lives in one
place and cannot drift.

---

## Deploy order

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

## Staff accounts — Trak sets them up

Nobody signs up as a coach or academy admin, and a coach cannot choose or change
their academy (TRAK-12, `20260926100000_staff_set_up_by_trak.sql`). The app
refuses all of it. The operator creates staff, one person at a time:

1. **Create the login.** Supabase dashboard → Authentication → Users: create the
   user directly (not an email invitation) with their email, a long random password
   that you neither keep nor send, and the email auto-confirmed. The app's handling
   of Supabase invitation links has no tests; the password reset in step 4 does.
2. **Admit them** in the dashboard SQL editor, which runs as `postgres`. Don't switch
   to an app role: the call refuses `authenticated` and `anon`. Do the admin first,
   because it creates the academy, then each coach into it:

   ```sql
   -- Academy admin: returns the academy id, creating the academy if they have none.
   SELECT public.admit_staff_member(
     (SELECT id FROM auth.users WHERE email = lower('<admin email>')),
     'club', '<Full Name>', NULL, '<Academy name>');
   -- Coach: into an existing academy.
   SELECT public.admit_staff_member(
     (SELECT id FROM auth.users WHERE email = lower('<coach email>')),
     'coach', '<Full Name>', (SELECT id FROM public.organizations WHERE name = '<Academy name>'));
   ```

   It refuses a missing account, an empty name, a coach with no existing academy,
   and an account that already has a different role.
3. **Check** before telling them:

   ```sql
   SELECT p.role, p.full_name, p.invite_code, o.name AS academy
   FROM public.profiles p
   LEFT JOIN public.coach_details cd ON cd.user_id = p.user_id
   LEFT JOIN public.organizations o
     ON o.id = cd.organization_id OR o.admin_user_id = p.user_id
   WHERE p.user_id = (SELECT id FROM auth.users WHERE email = lower('<email>'));
   ```

4. **Tell them** to open trakfootball.com, tap *Forgot password?* with that email,
   and set their own password from the email. Their profile is already there when
   they first sign in. A coach's `invite_code` is what their players type to link.

**Moving a coach** to another academy: run the coach call again with the new
academy. **Removing** one: run
`UPDATE public.coach_details SET organization_id = NULL WHERE user_id = …` in the
same editor. The academy screens are "Coming soon" for the pilot (TRAK-43), so an
admin can't do it in the app. Never hand out service credentials to do any of this
from a client.

## Rehearsal data

```bash
TRAK_REHEARSAL_PASSWORD='<set a fresh one, do not commit it>' node seed-pilot-rehearsal.mjs
```

Two squads, ~30 players, six weeks of fixtures, matches, assessments and awards under
`@rehearsal.trak.dev` / "Rehearsal FC". Reset with `--purge`.

The seed signs its staff in with the app key. Re-running it over the existing rehearsal
accounts works. **After `--purge`**, it would re-create the academy but be refused
moving the coaches into it. Their logins survive the purge, so run only step 2 above
first: `director@` as `club` with academy name "Rehearsal FC", then `coach.u15@`,
`coach.u17@` and `coach.gk@` into it. Then run the seed.

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

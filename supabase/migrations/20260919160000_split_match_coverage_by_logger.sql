-- ============================================================
-- S3 — the athlete-logging metric. Two defects, one decision.
--
-- Kostas's decision, 19 September: SPLIT the metric, and fix the drafts bug.
-- Evidence in docs/reviews/s3-athlete-logging-2026-09-19.md.
--
-- ── Defect 1: unpublished drafts are counted as fixtures
--
-- The `fixtures` CTE selects every coach_calendar_events row of type match or
-- tournament with no `published` filter. `published` defaults to FALSE, so a
-- coach drafting next month's fixture list immediately lowers the pilot's
-- reported coverage — the denominator grows the moment a fixture is typed,
-- while nobody could have logged a match that has not been announced and in
-- most cases has not been played.
--
-- Measured on the pilot data: 84 of the expected rows sit under published
-- fixtures and 98 under all fixtures, against 65 logged.
--
--   published fixtures only   84 expected → 77.4%
--   all fixtures (as shipped) 98 expected → 66.3%   ← what the report says
--
-- Week 7 read 0% for this reason and not because a week was missed.
--
-- ── Defect 2: the metric conflates two different claims
--
-- S3 is the ATHLETE-logging metric: the pilot question is whether players log
-- their own matches. The view already carries logged_by_role, and every one of
-- the 65 logged rows is 'coach'. Zero are 'player'.
--
-- A single "logged" percentage therefore reports 77.4% for a behaviour that has
-- happened zero times. The number is not wrong about what it measures; it
-- measures the wrong thing, and it is the headline on a pilot scorecard.
--
-- Splitting is deliberately additive: `logged` keeps its exact meaning, so
-- pilot_scorecard's match_coverage_pct is unchanged in definition and only
-- moves because the denominator is now correct. The two new columns are
-- appended, which is what CREATE OR REPLACE VIEW permits, and the per-role
-- percentages live in a new view rather than by altering the scorecard's shape.
-- ============================================================

CREATE OR REPLACE VIEW public.pilot_match_coverage AS
WITH fixtures AS (
  SELECT e.id AS fixture_id, e.coach_user_id, e.starts_at::date AS played_on, e.opponent
  FROM public.coach_calendar_events e
  JOIN public.pilot_coach_ids() pc ON pc.coach_user_id = e.coach_user_id
  WHERE e.event_type IN ('match', 'tournament')
    -- A fixture nobody has been told about cannot be under-logged.
    AND e.published
),
expected AS (
  SELECT f.fixture_id, f.played_on, f.coach_user_id, sp.linked_player_id AS player_user_id
  FROM fixtures f
  JOIN public.squad_players sp
    ON sp.coach_user_id = f.coach_user_id
   AND sp.linked_player_id IS NOT NULL
)
SELECT
  public.pilot_week(e.played_on::timestamptz)  AS week,
  e.fixture_id,
  e.played_on,
  e.player_user_id,
  m.id                                         AS match_id,
  m.logged_by_role,
  m.id IS NOT NULL                             AS logged,
  -- Appended, so existing consumers are untouched.
  m.id IS NOT NULL AND m.logged_by_role = 'player' AS logged_by_player,
  m.id IS NOT NULL AND m.logged_by_role = 'coach'  AS logged_by_coach
FROM expected e
LEFT JOIN public.matches m
       ON m.user_id = e.player_user_id
      AND m.match_date = e.played_on;

COMMENT ON VIEW public.pilot_match_coverage IS
  'Scorecard metric 2, scoped to the pilot org, PUBLISHED fixtures only. `logged` is any log; '
  'logged_by_player and logged_by_coach split it. S3 asks about athlete logging — read '
  'pilot_match_coverage_by_logger, not the combined figure.';


-- CREATE OR REPLACE VIEW resets security_invoker and the view's grants, so
-- 20260918070209's boundary has to be re-applied here or replacing the view
-- quietly re-opens it. pilot_view_security.sql catches this — it failed on
-- exactly these three assertions before this block existed, which is the guard
-- doing its job rather than a nuisance.
ALTER VIEW public.pilot_match_coverage SET (security_invoker = true);
REVOKE ALL ON TABLE public.pilot_match_coverage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pilot_match_coverage TO service_role;


-- Per-week split. A separate view so pilot_scorecard keeps its shape, and so
-- the athlete number has somewhere to be read that cannot be mistaken for the
-- combined one.
CREATE OR REPLACE VIEW public.pilot_match_coverage_by_logger AS
SELECT
  week,
  count(*)                                        AS expected,
  count(*) FILTER (WHERE logged)                  AS logged_any,
  count(*) FILTER (WHERE logged_by_player)        AS logged_player,
  count(*) FILTER (WHERE logged_by_coach)         AS logged_coach,
  round(100.0 * count(*) FILTER (WHERE logged)
        / NULLIF(count(*), 0), 1)                 AS logged_any_pct,
  round(100.0 * count(*) FILTER (WHERE logged_by_player)
        / NULLIF(count(*), 0), 1)                 AS logged_player_pct,
  round(100.0 * count(*) FILTER (WHERE logged_by_coach)
        / NULLIF(count(*), 0), 1)                 AS logged_coach_pct
FROM public.pilot_match_coverage
GROUP BY week;

COMMENT ON VIEW public.pilot_match_coverage_by_logger IS
  'S3 split by who logged the match. logged_player_pct is the athlete-logging metric the '
  'pilot actually asks about; logged_any_pct is the combined figure that was previously '
  'reported alone and read as though it were this one.';

-- Same boundary as every other operational view (20260918070209): reports are
-- a service-role SQL workflow, not an application API. A new view is otherwise
-- born reachable, which is the mistake that migration exists to prevent — and
-- an automatically-updatable view would be a write path around base-table RLS,
-- so SELECT-only revocation would not be enough.
ALTER VIEW public.pilot_match_coverage_by_logger SET (security_invoker = true);
REVOKE ALL ON TABLE public.pilot_match_coverage_by_logger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pilot_match_coverage_by_logger TO service_role;

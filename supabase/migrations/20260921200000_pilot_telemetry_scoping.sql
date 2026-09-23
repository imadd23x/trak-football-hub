-- ============================================================
-- Scope the telemetry-based pilot metrics to pilot_config.org_id
--
-- 20260901000005 scoped the roster and match views through pilot_coach_ids()
-- and never redefined the four that read telemetry_events. pilot_scorecard
-- reads three of them, so once a real academy is configured, its median
-- time-to-assess, blind rating agreement and player/parent return would still
-- include every other academy, dev account and rehearsal user. Measured on a
-- two-academy fixture (supabase/tests/pilot_scope.sql, section F): median
-- 900s where the pilot academy's is 10s; agreement 33.3% where it is 100%.
--
-- Same contract as 20260901000005: org_id NULL means unscoped, exactly as
-- before. Columns, grants and security_invoker are unchanged; the post-
-- condition at the end refuses to apply otherwise.
-- ============================================================

-- The people in the pilot: its coaches, the players linked to their rosters,
-- and those players' parents. Coaches reuse pilot_coach_ids() so the two
-- definitions of "in the pilot academy" cannot drift apart.
CREATE OR REPLACE FUNCTION public.pilot_member_ids()
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT pc.coach_user_id FROM public.pilot_coach_ids() pc
  UNION
  SELECT sp.linked_player_id
  FROM public.squad_players sp
  JOIN public.pilot_coach_ids() pc ON pc.coach_user_id = sp.coach_user_id
  WHERE sp.linked_player_id IS NOT NULL
  UNION
  SELECT ppl.parent_user_id
  FROM public.player_parent_links ppl
  JOIN public.squad_players sp ON sp.linked_player_id = ppl.player_user_id
  JOIN public.pilot_coach_ids() pc ON pc.coach_user_id = sp.coach_user_id;
$$;

COMMENT ON FUNCTION public.pilot_member_ids() IS
  'Coaches, linked players and their parents in the pilot organisation. Views apply it only when pilot_config.org_id is set.';

-- Reporting only; the views run as their (service_role) caller.
REVOKE ALL ON FUNCTION public.pilot_member_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_member_ids() TO service_role;

-- ── Time to assess: coach events ────────────────────────────
-- The scope is a WHERE subquery, not a join: a single FROM item keeps these two
-- views auto-updatable, so a write through them is still refused by privilege
-- (42501), exactly as pilot_view_security.sql asserts, rather than by shape.
CREATE OR REPLACE VIEW public.pilot_time_to_assess WITH (security_invoker = true) AS
SELECT
  public.pilot_week(t.created_at)                          AS week,
  t.user_id                                                AS coach_user_id,
  t.event_type,
  (t.metadata ->> 'duration_ms')::numeric / 1000.0         AS run_seconds,
  (t.metadata ->> 'players')::int                          AS players,
  round(
    (t.metadata ->> 'duration_ms')::numeric / 1000.0
    / GREATEST((t.metadata ->> 'players')::numeric, 1), 1)  AS seconds,
  (t.metadata ->> 'mode')                                  AS mode,
  t.created_at
FROM public.telemetry_events t
WHERE t.event_type IN ('assessment_submitted', 'quick_assess_completed')
  AND t.metadata ? 'duration_ms'
  AND (t.metadata ->> 'duration_ms') IS NOT NULL
  AND COALESCE((t.metadata ->> 'players')::int, 1) > 0
  AND ((SELECT org_id FROM public.pilot_config WHERE id) IS NULL
       OR t.user_id IN (SELECT coach_user_id FROM public.pilot_coach_ids()));

-- ── Blind rating agreement: coach events ────────────────────
CREATE OR REPLACE VIEW public.pilot_rating_agreement WITH (security_invoker = true) AS
SELECT
  public.pilot_week(t.created_at)                          AS week,
  t.user_id                                                AS coach_user_id,
  t.metadata ->> 'player_user_id'                          AS player_user_id,
  t.metadata ->> 'position'                                AS position,
  t.metadata ->> 'gut_band'                                AS gut_band,
  t.metadata ->> 'computed_band'                           AS computed_band,
  public.band_ordinal(t.metadata ->> 'gut_band')           AS gut_ord,
  public.band_ordinal(t.metadata ->> 'computed_band')      AS computed_ord,
  abs(
    public.band_ordinal(t.metadata ->> 'gut_band')
    - public.band_ordinal(t.metadata ->> 'computed_band')
  )                                                        AS band_gap,
  abs(
    public.band_ordinal(t.metadata ->> 'gut_band')
    - public.band_ordinal(t.metadata ->> 'computed_band')
  ) <= 1                                                   AS agrees,
  public.band_ordinal(t.metadata ->> 'computed_band')
    - public.band_ordinal(t.metadata ->> 'gut_band')       AS engine_bias,
  t.created_at
FROM public.telemetry_events t
WHERE t.event_type = 'blind_rating_captured'
  AND ((SELECT org_id FROM public.pilot_config WHERE id) IS NULL
       OR t.user_id IN (SELECT coach_user_id FROM public.pilot_coach_ids()));

-- ── Weekly active: everyone in the pilot. pilot_retention reads this view,
--    so it is scoped by the same change without being redefined.
CREATE OR REPLACE VIEW public.pilot_weekly_active WITH (security_invoker = true) AS
SELECT
  public.pilot_week(t.created_at)                          AS week,
  COALESCE(t.role, p.role::text)                           AS role,
  t.user_id,
  count(*)                                                 AS events,
  min(t.created_at)                                        AS first_seen,
  max(t.created_at)                                        AS last_seen
FROM public.telemetry_events t
LEFT JOIN public.profiles p ON p.user_id = t.user_id
CROSS JOIN (SELECT org_id FROM public.pilot_config WHERE id) cfg
WHERE cfg.org_id IS NULL OR t.user_id IN (SELECT user_id FROM public.pilot_member_ids())
GROUP BY 1, 2, 3;

-- ── Post-conditions: what a replay leaves behind, not what this file meant ──
DO $post$
DECLARE v record;
BEGIN
  FOR v IN
    SELECT c.relname, c.reloptions, c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('pilot_time_to_assess', 'pilot_rating_agreement', 'pilot_weekly_active', 'pilot_retention')
  LOOP
    IF NOT (coalesce(v.reloptions, '{}') @> ARRAY['security_invoker=true']) THEN
      RAISE EXCEPTION '% lost security_invoker', v.relname;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v.relname), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', v.relname), 'SELECT') THEN
      RAISE EXCEPTION '% is readable by a client role', v.relname;
    END IF;
  END LOOP;
END;
$post$;

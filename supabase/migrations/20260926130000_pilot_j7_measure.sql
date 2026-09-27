-- ============================================================
-- J7 (TRAK-10): the one-minute answer.
--
--   SELECT * FROM public.pilot_j7_this_week;
--
-- On any pilot day: assessments each coach made this week, and player and
-- parent opens this week. Real UI events only; seeded and synthetic accounts
-- never count; only the pilot academy counts.
--
-- Why not count rows or raw events:
--   * Seeds write coach_assessments directly, so rows are not UI events.
--     telemetry_events is written only by the app (trackEvent).
--   * Any signed-in user may append telemetry for themselves
--     (20260901000001), so an event is a claim, not a fact. Every event here
--     is checked against the record it names: the assessment must exist and
--     be the event author's; an open must come from the child on that
--     assessment's roster row, or from a parent linked to that child.
--   * feedback_opened fires every time player home shows the message
--     (TRAK-71), and assessment_viewed every time parent home shows the
--     bands. So an open is a distinct (person, assessment) pair per week,
--     never an event count (Imad, TRAK-10, 25 Sep).
--   * Parents never see the coach's message (TRAK-63), so a parent open is the
--     child's latest assessment reaching parent home (`assessment_viewed`).
--
-- Weeks are pilot weeks (pilot_week(), from pilot_config.starts_on), the same
-- as every other pilot_* report.
-- ============================================================

-- ── Synthetic accounts ──────────────────────────────────────
-- Rehearsal FC (@rehearsal.trak.dev), dev seeds (@trak.dev) and the reserved
-- test domains (RFC 2606/6761). The switch exists for the rehearsal (TRAK-24),
-- which must see the measurement work on synthetic accounts; it is false for
-- the pilot and anything that reads it must treat NULL as false.
ALTER TABLE public.pilot_config
  ADD COLUMN IF NOT EXISTS count_synthetic boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pilot_config.count_synthetic IS
  'Rehearsal only. When true, J7 reports count synthetic accounts. Must be false during the pilot.';

-- SECURITY DEFINER because the reports run as service_role, which holds no
-- grant on auth.users. Returns ids only, never an email.
CREATE OR REPLACE FUNCTION public.pilot_synthetic_user_ids()
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM auth.users u
  CROSS JOIN LATERAL (SELECT lower(split_part(u.email, '@', 2)) AS d) e
  WHERE e.d = 'trak.dev' OR e.d LIKE '%.trak.dev'
     OR e.d IN ('example.com', 'example.org', 'example.net')
     OR e.d LIKE '%.example' OR e.d LIKE '%.test'
     OR e.d LIKE '%.invalid' OR e.d LIKE '%.localhost';
$$;

COMMENT ON FUNCTION public.pilot_synthetic_user_ids() IS
  'Accounts on synthetic or reserved test domains. J7 reports exclude them unless pilot_config.count_synthetic.';

REVOKE ALL ON FUNCTION public.pilot_synthetic_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_synthetic_user_ids() TO service_role;

-- Who counts: in the pilot academy (when one is configured), and not
-- synthetic (unless the rehearsal switch is on).
CREATE OR REPLACE FUNCTION public.pilot_counts_user(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    ((SELECT org_id FROM public.pilot_config WHERE id) IS NULL
      OR uid IN (SELECT m.user_id FROM public.pilot_member_ids() m))
    AND (COALESCE((SELECT count_synthetic FROM public.pilot_config WHERE id), false)
      OR uid NOT IN (SELECT s.user_id FROM public.pilot_synthetic_user_ids() s));
$$;

REVOKE ALL ON FUNCTION public.pilot_counts_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_counts_user(uuid) TO service_role;

-- The assessment an event names, or NULL. A malformed id must not fail the
-- whole report, so the cast only runs on a well-formed value.
CREATE OR REPLACE FUNCTION public.pilot_event_assessment_id(metadata jsonb)
RETURNS uuid
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN metadata ->> 'assessment_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (metadata ->> 'assessment_id')::uuid
  END;
$$;

REVOKE ALL ON FUNCTION public.pilot_event_assessment_id(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_event_assessment_id(jsonb) TO service_role;

-- ── Assessments per coach per week ──────────────────────────
-- One row per coach, week and assessment saved from the assessment screen.
-- `created` is true for the save that created the row (updated = false); an
-- edit of an earlier assessment still counts as work done that week.
CREATE OR REPLACE VIEW public.pilot_j7_assessments WITH (security_invoker = true) AS
SELECT
  public.pilot_week(t.created_at)                          AS week,
  t.user_id                                                AS coach_user_id,
  ca.id                                                    AS assessment_id,
  bool_or(COALESCE((t.metadata ->> 'updated')::boolean, false) = false) AS created,
  min(t.created_at)                                        AS first_saved_at
FROM public.telemetry_events t
JOIN public.coach_assessments ca
  ON ca.id = public.pilot_event_assessment_id(t.metadata)
 AND ca.coach_user_id = t.user_id
JOIN public.profiles p ON p.user_id = t.user_id AND p.role = 'coach'
WHERE t.event_type = 'assessment_submitted'
  AND public.pilot_counts_user(t.user_id)
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.pilot_j7_assessments IS
  'J7. One row per coach, pilot week and assessment saved in the app. Checked against coach_assessments; synthetic and non-pilot accounts excluded.';

-- ── Opens per week ──────────────────────────────────────────
-- One row per person, week and assessment they opened.
CREATE OR REPLACE VIEW public.pilot_j7_opens WITH (security_invoker = true) AS
SELECT
  public.pilot_week(t.created_at)                          AS week,
  CASE t.event_type WHEN 'feedback_opened' THEN 'player' ELSE 'parent' END AS role,
  t.user_id,
  ca.id                                                    AS assessment_id,
  min(t.created_at)                                        AS first_opened_at
FROM public.telemetry_events t
JOIN public.coach_assessments ca ON ca.id = public.pilot_event_assessment_id(t.metadata)
JOIN public.squad_players sp ON sp.id = ca.squad_player_id
WHERE t.event_type IN ('feedback_opened', 'assessment_viewed')
  AND public.pilot_counts_user(t.user_id)
  AND (
    -- The child, opening a message the coach has published.
    (t.event_type = 'feedback_opened'
      AND sp.linked_player_id = t.user_id
      AND EXISTS (SELECT 1 FROM public.coach_shared_feedback f
                  WHERE f.assessment_id = ca.id AND f.published_at IS NOT NULL))
    OR
    -- A parent linked to that child, seeing the assessment's bands.
    (t.event_type = 'assessment_viewed'
      AND EXISTS (SELECT 1 FROM public.player_parent_links l
                  WHERE l.parent_user_id = t.user_id
                    AND l.player_user_id = sp.linked_player_id))
  )
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW public.pilot_j7_opens IS
  'J7. One row per person, pilot week and assessment opened (player: published message; parent: the bands). Checked against the roster and parent links; synthetic and non-pilot accounts excluded.';

-- ── The answer ──────────────────────────────────────────────
-- Every pilot coach appears, with 0 if they assessed nobody: a missing coach
-- would read as a coach who does not exist rather than one who did nothing.
CREATE OR REPLACE VIEW public.pilot_j7_this_week WITH (security_invoker = true) AS
WITH wk AS (SELECT public.pilot_week(now()) AS week),
coaches AS (
  SELECT p.user_id, p.full_name
  FROM public.profiles p
  WHERE p.role = 'coach'
    AND p.user_id IN (SELECT c.coach_user_id FROM public.pilot_coach_ids() c)
    AND public.pilot_counts_user(p.user_id)
)
SELECT wk.week, 'assessments'::text AS metric, c.full_name AS coach, c.user_id AS coach_user_id,
       (SELECT count(*) FROM public.pilot_j7_assessments a
         WHERE a.week = wk.week AND a.coach_user_id = c.user_id) AS value
FROM wk CROSS JOIN coaches c
UNION ALL
SELECT wk.week, r.metric, NULL, NULL,
       (SELECT count(*) FROM public.pilot_j7_opens o WHERE o.week = wk.week AND o.role = r.role)
FROM wk CROSS JOIN (VALUES ('player_opens', 'player'), ('parent_opens', 'parent')) AS r(metric, role);

COMMENT ON VIEW public.pilot_j7_this_week IS
  'J7, the one-minute answer: SELECT * FROM pilot_j7_this_week; One row per pilot coach (assessments this week) plus player_opens and parent_opens.';

-- ── Access: reports are service_role only, like every pilot_* view ──
DO $migration$
DECLARE view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY['pilot_j7_assessments', 'pilot_j7_opens', 'pilot_j7_this_week'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', view_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', view_name);
  END LOOP;
END;
$migration$;

-- ── Post-conditions ─────────────────────────────────────────
DO $post$
DECLARE v record;
BEGIN
  FOR v IN
    SELECT c.relname, c.reloptions
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('pilot_j7_assessments', 'pilot_j7_opens', 'pilot_j7_this_week')
  LOOP
    IF NOT (coalesce(v.reloptions, '{}') @> ARRAY['security_invoker=true']) THEN
      RAISE EXCEPTION '% lost security_invoker', v.relname;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v.relname), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', v.relname), 'SELECT') THEN
      RAISE EXCEPTION '% is readable by a client role', v.relname;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.pilot_synthetic_user_ids()', 'EXECUTE') THEN
    RAISE EXCEPTION 'pilot_synthetic_user_ids() is callable by a client role';
  END IF;
END;
$post$;

-- G1 (MVP Requirements): no development record about an under-18 exists
-- without active consent, on every write path. G6: withdrawal stops
-- processing at once.
--
-- Before this migration only two writes checked consent: a new assessment and
-- a new award. After a guardian withdrew, a coach could still edit an
-- assessment, write or edit its private note, publish or edit the message,
-- take attendance, and log a match through log_match_for_player. A child could
-- also write match rows about themselves, although player logging is cut.
--
-- Each policy below is recreated with its existing clauses plus the consent
-- predicate, through the RLS bridge trak_private.squad_player_consent_required
-- (20260921182442). Policies, not triggers: account deletion and coach
-- departure run as SECURITY DEFINER maintenance and must still be able to
-- update these rows for a child whose guardian has withdrawn.
--
-- The coach can still retract a published message after withdrawal (G6,
-- 20260921110000), and only retract: the text, assessment and owner stay as
-- they were.
--
-- Unknown age fails closed (MVP J1: a missing date of birth counts as a
-- minor). 20260912000001 let writes through for a roster row with no account
-- and for a player with no date of birth. Neither can hold consent
-- (record_parental_consent refuses a missing DOB), so both now wait.

-- ── Consent helpers: unknown age means consent is required ─────────────────
-- CREATE OR REPLACE keeps the grants set in 20260921182442.
CREATE OR REPLACE FUNCTION public.player_consent_required(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT NOT COALESCE(
    public.player_age_years(p_user_id) >= public.consent_threshold_age()
      OR public.player_has_parental_consent(p_user_id),
    false
  );
$fn$;

CREATE OR REPLACE FUNCTION public.squad_player_consent_required(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT sp.linked_player_id IS NULL
      OR public.player_consent_required(sp.linked_player_id)
  FROM public.squad_players sp
  WHERE sp.id = p_squad_player_id;
$fn$;

-- ── coach_assessments: editing needs consent, as creating already does ──────
DROP POLICY IF EXISTS "Coaches can update own assessments" ON public.coach_assessments;
CREATE POLICY "Coaches can update own assessments"
  ON public.coach_assessments FOR UPDATE TO authenticated
  USING (coach_user_id = auth.uid() AND public.is_coach() AND public.squad_player_is_mine(squad_player_id))
  WITH CHECK (
    coach_user_id = auth.uid() AND public.is_coach() AND public.squad_player_is_mine(squad_player_id)
    AND (session_id IS NULL OR public.coach_session_is_mine(session_id))
    AND NOT trak_private.squad_player_consent_required(squad_player_id)
  );

-- ── coach_assessment_notes ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Coaches can insert assessment notes" ON public.coach_assessment_notes;
CREATE POLICY "Coaches can insert assessment notes"
  ON public.coach_assessment_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.is_coach() AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_assessment_notes.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
        AND NOT trak_private.squad_player_consent_required(ca.squad_player_id)
    )
  );

DROP POLICY IF EXISTS "Coaches can update own assessment notes" ON public.coach_assessment_notes;
CREATE POLICY "Coaches can update own assessment notes"
  ON public.coach_assessment_notes FOR UPDATE TO authenticated
  USING (
    public.is_coach() AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_assessment_notes.assessment_id AND ca.coach_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_coach() AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_assessment_notes.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
        AND NOT trak_private.squad_player_consent_required(ca.squad_player_id)
    )
  );

-- ── coach_shared_feedback: new or published text needs consent ──────────────
DROP POLICY IF EXISTS "Coaches insert own shared feedback" ON public.coach_shared_feedback;
CREATE POLICY "Coaches insert own shared feedback"
  ON public.coach_shared_feedback FOR INSERT TO authenticated
  WITH CHECK (
    public.is_coach() AND coach_user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
        AND NOT trak_private.squad_player_consent_required(ca.squad_player_id)
    )
  );

-- The row as it was before the UPDATE. WITH CHECK sees only the new row, and a
-- policy cannot read its own table (42P17), so a definer function reads it
-- under the statement's snapshot. RLS-only, like the consent bridge.
CREATE OR REPLACE FUNCTION trak_private.shared_feedback_unchanged(
  p_id uuid, p_assessment_id uuid, p_coach_user_id uuid, p_body text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_shared_feedback
    WHERE id = p_id AND assessment_id = p_assessment_id
      AND coach_user_id = p_coach_user_id AND body = p_body);
$fn$;
REVOKE ALL ON FUNCTION trak_private.shared_feedback_unchanged(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.shared_feedback_unchanged(uuid, uuid, uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Coaches update own shared feedback" ON public.coach_shared_feedback;
CREATE POLICY "Coaches update own shared feedback"
  ON public.coach_shared_feedback FOR UPDATE TO authenticated
  USING (
    public.is_coach() AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_shared_feedback.assessment_id AND ca.coach_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_coach() AND coach_user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
        AND (NOT trak_private.squad_player_consent_required(ca.squad_player_id)
             -- Without consent, only a retraction: nothing else changes.
             OR (coach_shared_feedback.published_at IS NULL
                 AND trak_private.shared_feedback_unchanged(coach_shared_feedback.id,
                       coach_shared_feedback.assessment_id, coach_shared_feedback.coach_user_id,
                       coach_shared_feedback.body)))
    )
  );

-- ── session_attendance ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Coaches can insert attendance for own sessions" ON public.session_attendance;
CREATE POLICY "Coaches can insert attendance for own sessions"
  ON public.session_attendance FOR INSERT TO authenticated
  WITH CHECK (
    public.is_coach() AND public.coach_session_is_mine(session_id)
    AND public.squad_player_is_mine(squad_player_id)
    AND NOT trak_private.squad_player_consent_required(squad_player_id)
  );

DROP POLICY IF EXISTS "Coaches can update attendance for own sessions" ON public.session_attendance;
CREATE POLICY "Coaches can update attendance for own sessions"
  ON public.session_attendance FOR UPDATE TO authenticated
  USING (public.is_coach() AND public.coach_session_is_mine(session_id))
  WITH CHECK (
    public.is_coach() AND public.coach_session_is_mine(session_id)
    AND public.squad_player_is_mine(squad_player_id)
    AND NOT trak_private.squad_player_consent_required(squad_player_id)
  );

-- ── recognition_awards: editing needs consent, as creating already does ─────
DROP POLICY IF EXISTS "Coaches can update own awards" ON public.recognition_awards;
CREATE POLICY "Coaches can update own awards"
  ON public.recognition_awards FOR UPDATE TO authenticated
  USING (coach_user_id = auth.uid() AND public.is_coach() AND public.squad_player_is_mine(squad_player_id))
  WITH CHECK (
    coach_user_id = auth.uid() AND public.is_coach() AND public.squad_player_is_mine(squad_player_id)
    AND NOT trak_private.squad_player_consent_required(squad_player_id)
  );

-- ── matches: player logging is cut (MVP Requirements), so its writes close ──
-- The coach logs through log_match_for_player. No app screen writes matches as
-- a player; DevSetupPage (local development only) did.
DROP POLICY IF EXISTS "Players can insert own matches" ON public.matches;
DROP POLICY IF EXISTS "Players can update own matches" ON public.matches;
-- Grants follow policies (privilege_and_consent_security A1b). The RPC runs as
-- its owner and needs neither.
REVOKE INSERT, UPDATE ON public.matches FROM anon, authenticated;

-- ── log_match_for_player: same body as 20260920150000, plus consent ─────────
CREATE OR REPLACE FUNCTION public.log_match_for_player(
  p_user_id         uuid,
  p_opponent        text,
  p_team_score      integer,
  p_opponent_score  integer,
  p_competition     text,
  p_venue           text,
  p_position        text,
  p_age_group       text,
  p_minutes_played  integer,
  p_goals           integer,
  p_assists         integer,
  p_card_received   text,
  p_body_condition  text,
  p_self_rating     text,
  p_computed_rating numeric,
  p_match_date      date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed integer;
BEGIN
  -- The row records logged_by_role = 'coach'. Check it rather than assert it.
  IF NOT public.is_coach() THEN
    RAISE EXCEPTION 'Not authorised: caller is not a coach';
  END IF;

  -- Caller must currently hold this player: their roster row, not departed,
  -- and in the academy the caller is in now. squad_player_is_mine() is the
  -- single definition of that, shared with every coach write policy.
  IF NOT EXISTS (
    SELECT 1 FROM public.squad_players sp
    WHERE sp.linked_player_id = p_user_id
      AND public.squad_player_is_mine(sp.id)
  ) THEN
    RAISE EXCEPTION 'Not authorised: caller is not the coach of player %', p_user_id;
  END IF;

  -- G1: nothing is recorded about a child until a parent has approved.
  -- 42501, like the RLS refusals, so the app can re-check consent and say why.
  IF EXISTS (
    SELECT 1 FROM public.squad_players sp
    WHERE sp.linked_player_id = p_user_id
      AND public.squad_player_is_mine(sp.id)
      AND public.squad_player_consent_required(sp.id)
  ) THEN
    RAISE EXCEPTION 'Waiting for parent: nothing is recorded about player % until a parent approves', p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- ── What the coach claims must be possible ────────────────
  IF p_minutes_played IS NULL OR p_minutes_played < 0 OR p_minutes_played > 120 THEN
    RAISE EXCEPTION 'Minutes played must be between 0 and 120, got %', p_minutes_played;
  END IF;

  IF p_goals IS NULL OR p_goals < 0 OR p_goals > 20 THEN
    RAISE EXCEPTION 'Goals must be between 0 and 20, got %', p_goals;
  END IF;

  IF p_assists IS NULL OR p_assists < 0 OR p_assists > 20 THEN
    RAISE EXCEPTION 'Assists must be between 0 and 20, got %', p_assists;
  END IF;

  IF p_minutes_played = 0 AND (p_goals > 0 OR p_assists > 0) THEN
    RAISE EXCEPTION 'A player with no minutes cannot have goals or assists';
  END IF;

  IF p_team_score IS NOT NULL AND p_goals > p_team_score THEN
    RAISE EXCEPTION 'A player cannot score more than the team''s %', p_team_score;
  END IF;

  allowed := greatest(3, p_minutes_played / 5);
  IF p_minutes_played > 0 AND p_goals + p_assists > allowed THEN
    RAISE EXCEPTION '% goals and assists in % minutes is not possible (max %)',
      p_goals + p_assists, p_minutes_played, allowed;
  END IF;

  INSERT INTO public.matches (
    user_id, opponent, team_score, opponent_score, competition, venue,
    position, age_group, minutes_played, goals, assists, card_received,
    body_condition, self_rating, computed_rating,
    match_date, logged_by, logged_by_role
  ) VALUES (
    p_user_id, p_opponent, p_team_score, p_opponent_score, p_competition, p_venue,
    p_position, p_age_group, p_minutes_played, p_goals, p_assists, p_card_received,
    p_body_condition, p_self_rating, p_computed_rating,
    COALESCE(p_match_date, CURRENT_DATE), auth.uid(), 'coach'
  );
END;
$$;

-- ── Post-conditions ──────────────────────────────────────────────────────────
DO $migration$
DECLARE
  problems text := '';
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('coach_assessments',      'Coaches can update own assessments'),
    ('coach_assessment_notes', 'Coaches can insert assessment notes'),
    ('coach_assessment_notes', 'Coaches can update own assessment notes'),
    ('coach_shared_feedback',  'Coaches insert own shared feedback'),
    ('coach_shared_feedback',  'Coaches update own shared feedback'),
    ('session_attendance',     'Coaches can insert attendance for own sessions'),
    ('session_attendance',     'Coaches can update attendance for own sessions'),
    ('recognition_awards',     'Coaches can update own awards')
  ) AS t(tbl, pol)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.pol
        AND with_check LIKE '%squad_player_consent_required%'
    ) THEN
      problems := problems || format(E'\n  %s.%s does not check consent', r.tbl, r.pol);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'matches' AND cmd IN ('INSERT', 'UPDATE', 'ALL')
  ) THEN
    problems := problems || E'\n  matches still has a client write policy';
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.log_match_for_player(uuid,text,integer,integer,text,text,text,text,integer,integer,integer,text,text,text,numeric,date)'::regprocedure)
     NOT LIKE '%squad_player_consent_required%' THEN
    problems := problems || E'\n  log_match_for_player does not check consent';
  END IF;

  -- The coach's own read must stay consent-free (20260921110000), or a
  -- withdrawal would lock them out of retracting their own words.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_shared_feedback'
      AND policyname = 'Coaches read own shared feedback'
      AND qual LIKE '%squad_player_consent_required%'
  ) THEN
    problems := problems || E'\n  the coach''s own read now depends on consent';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'G1 consent-on-write post-condition failed:%', problems;
  END IF;
END;
$migration$;

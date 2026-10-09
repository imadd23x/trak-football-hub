-- TRAK-149 (J4): a match's scores must add up, in the database.
-- public.matches has one row per player and no match row, and
-- log_match_for_player() checked each player alone. So two one-goal scorers in
-- a 1-0 were two individually legal rows, and players from one match could be
-- saved with different scores. The app's teamGoalsViolation() only guards its
-- own screen; anything calling the RPC directly bypassed it.
--
-- Same function, same signature, same grants (CREATE OR REPLACE); the body is
-- 20260926140000's with one block added before the INSERT. It is the only
-- write path: app roles hold SELECT only on matches. Existing rows are not
-- touched; the old Rehearsal FC seed matches already disagree with themselves.

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
  match_opponent text := lower(btrim(coalesce(p_opponent, '')));
  match_day date := COALESCE(p_match_date, CURRENT_DATE);
  match_goals integer;
  match_team integer;
  match_opponent_score integer;
  score_differs boolean;
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

  -- ── TRAK-149: the match's rows must add up ─────────────────
  -- One row per player, and no match row, so this coach's rows on this date
  -- against this opponent (case and spaces ignored) are one match. The lock
  -- makes two players saved at the same moment take turns, so both can't pass
  -- the total. Reads below run after it and see the other's committed row.
  -- ponytail: two games against one opponent on one day count as one match;
  -- J8.15's event id can replace this key.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text || '|' || match_day::text || '|' || match_opponent, 149));

  SELECT coalesce(sum(m.goals), 0), min(m.team_score), min(m.opponent_score),
         bool_or(m.team_score IS DISTINCT FROM p_team_score
                 OR m.opponent_score IS DISTINCT FROM p_opponent_score)
    INTO match_goals, match_team, match_opponent_score, score_differs
  FROM public.matches m
  WHERE m.logged_by = auth.uid()
    AND m.logged_by_role = 'coach'
    AND m.match_date = match_day
    AND lower(btrim(coalesce(m.opponent, ''))) = match_opponent;

  IF score_differs THEN
    RAISE EXCEPTION 'This match is already saved as %-%; every player in it needs the same score',
      match_team, match_opponent_score;
  END IF;

  -- Fewer is fine: own goals, or a scorer who isn't on the roster.
  IF p_team_score IS NOT NULL AND match_goals + p_goals > p_team_score THEN
    RAISE EXCEPTION '% goals entered, but the team scored %', match_goals + p_goals, p_team_score;
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

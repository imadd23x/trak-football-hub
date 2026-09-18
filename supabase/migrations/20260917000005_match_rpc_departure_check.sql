-- ============================================================
-- F5 from the K1/K2 departure audit
-- (docs/reviews/k1-k2-departure.md, Imad/Codex, 18 Sept).
--
-- log_match_for_player() authorises the caller like this:
--
--   IF NOT EXISTS (
--     SELECT 1 FROM public.squad_players
--     WHERE linked_player_id = p_user_id
--       AND coach_user_id    = auth.uid()
--   ) THEN ...
--
-- Ownership and nothing else. No departure status, no academy. So a coach
-- removed from an academy can still log matches for that academy's children,
-- and so can one who has since joined a different academy.
--
-- This is the case no amount of policy work reaches. The function is
-- SECURITY DEFINER, so RLS does not apply inside it: K1's write policies and
-- K2's departure gate are both invisible here. Every fix so far has been
-- written in RLS, and this path went around all of it.
--
-- The rule it should apply is the one K2 and F2 already settled: a coach may
-- act on a roster row that is theirs, not departed, and belongs to the
-- academy they are in now. Rather than restate that here — a third copy to
-- drift out of step — the check routes through squad_player_is_mine(), so
-- this RPC now inherits any future tightening of that definition instead of
-- needing to be found and changed again.
--
-- Also requires the caller to actually hold the coach role. The row it writes
-- stamps logged_by_role = 'coach', which until now was asserted rather than
-- checked.
--
-- Only the 16-argument signature exists: 20260901000002 dropped the earlier
-- 15-argument overload before creating this one, so there is no second entry
-- point left carrying the old check.
--
-- Unchanged: the INSERT, the parameter list, and the function's grants, which
-- CREATE OR REPLACE preserves. Note for a follow-up rather than this
-- migration — the function has no explicit GRANT and so carries Postgres's
-- default PUBLIC EXECUTE. That is not currently exploitable, because
-- auth.uid() is NULL for an anonymous caller and both checks below then fail,
-- but it is wider than it needs to be.
-- ============================================================

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

-- ============================================================
-- A match record must describe something that could have happened
--
-- `matches.minutes_played`, `.goals` and `.assists` are plain
-- `integer NOT NULL DEFAULT 0`. The only CHECK constraint on the table governs
-- `logged_by_role`. `log_match_for_player()` passes all three straight through
-- to the INSERT without looking at them.
--
-- So nothing refuses an impossible record. Measured on a fresh replay of every
-- migration, by direct insert:
--
--   goals = 999,  assists = 0, minutes = 90    ACCEPTED and stored
--   goals = 1,    assists = 0, minutes = -45   ACCEPTED
--   goals = -3,   assists = 0, minutes = 90    ACCEPTED
--
-- The pilot's purpose is to produce numbers somebody will later trust. A
-- scorecard computed over records like these is worse than no scorecard,
-- because it looks like measurement.
--
-- Rules agreed with @kostasanastasioubusiness-lang:
--
--   minutes    whole number, 0..120
--   goals      whole number, 0..20        } hard backstops; the two
--   assists    whole number, 0..20        } relational rules bind tighter
--   a player with no minutes has no goals or assists
--   goals + assists <= greatest(3, minutes / 5)
--
-- ── Why the contribution rule has a floor of 3
--
-- The rule as first proposed was `goals + assists <= minutes / 5`, and it
-- refuses ordinary football. A substitute on for five minutes who scores twice
-- computes 5/5 = 1 and is rejected. Someone brought on in the 89th minute who
-- scores immediately computes 1/5 = 0 and is rejected. The ratio is a sanity
-- check against absurd claims, not a model of scoring rate, so it needs a
-- floor. Three contributions are allowed at any non-zero minute; above roughly
-- fifteen minutes the ratio takes over.
--
-- ── Why goals are only compared to the score when it is known
--
-- `team_score` may legitimately be 0 while a coach is still filling the form.
-- Comparing against it unconditionally would refuse every record entered
-- goals-first. The constraint therefore only bites when a score is present and
-- the claim exceeds it.
--
-- ── Why the constraints are NOT VALID
--
-- Adding a validated CHECK scans every existing row and fails the whole
-- migration if one violates it. This database has real history, including
-- records written before any rule existed, and I cannot see production from
-- here to know whether any of them are impossible. A migration that might
-- abort on live data is not a migration, it is a gamble.
--
-- NOT VALID enforces the rule on every INSERT and UPDATE from now on — which
-- is the entire protective value — while leaving existing rows alone. Section
-- 3 reports how many rows would fail, so the number is known rather than
-- assumed. Validating them is a separate reviewed step once that number is
-- seen and any offending rows are corrected:
--
--   ALTER TABLE public.matches VALIDATE CONSTRAINT matches_minutes_in_range;
--
-- Rollback: ALTER TABLE public.matches DROP CONSTRAINT <name>; and restore the
-- previous body of log_match_for_player from 20260917000005.
-- ============================================================

-- ── 1. The table refuses impossible rows ─────────────────────
-- Idempotent: dropped first so a replay in any order converges.
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_minutes_in_range;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_goals_in_range;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_assists_in_range;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_no_minutes_no_contribution;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_goals_within_team_score;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_contributions_fit_minutes;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_minutes_in_range
  CHECK (minutes_played BETWEEN 0 AND 120) NOT VALID;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_goals_in_range
  CHECK (goals BETWEEN 0 AND 20) NOT VALID;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_assists_in_range
  CHECK (assists BETWEEN 0 AND 20) NOT VALID;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_no_minutes_no_contribution
  CHECK (minutes_played > 0 OR (goals = 0 AND assists = 0)) NOT VALID;

-- Only when a score is recorded. NULL team_score yields NULL, and a CHECK
-- passes on NULL — deliberately, per the note above.
ALTER TABLE public.matches
  ADD CONSTRAINT matches_goals_within_team_score
  CHECK (team_score IS NULL OR goals <= team_score) NOT VALID;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_contributions_fit_minutes
  CHECK (
    minutes_played = 0
    OR goals + assists <= greatest(3, minutes_played / 5)
  ) NOT VALID;


-- ── 2. The RPC says why, in words a coach can read ───────────
-- A CHECK violation surfaces as a Postgres constraint error naming
-- `matches_contributions_fit_minutes`, which is useless to the person who
-- typed the number. The RPC therefore validates first and raises its own
-- message. The constraints remain as the barrier that cannot be bypassed.
--
-- Body is 20260917000005's with section 3 added; the coach check and the
-- departure check are carried over unchanged and must stay.
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

COMMENT ON FUNCTION public.log_match_for_player IS
  'Coach-side match logging. Verifies the caller is a coach who currently holds '
  'the player (20260917000005), then refuses records that describe something '
  'that could not have happened (20260920150000). The CHECK constraints on '
  'public.matches are the barrier; these messages exist so a coach is told what '
  'is wrong rather than reading a constraint name.';


-- ── 3. Report, do not assume ─────────────────────────────────
-- How many existing rows each new rule would reject, printed at apply time.
-- Zero everywhere means the constraints can be validated immediately; a
-- non-zero count is the work that has to happen first, and is better seen in
-- the migration log than discovered later by a failing VALIDATE.
DO $migration$
DECLARE
  r record;
  total integer := 0;
BEGIN
  FOR r IN
    SELECT 'minutes outside 0..120' AS rule,
           count(*)::int AS n FROM public.matches
     WHERE minutes_played < 0 OR minutes_played > 120
    UNION ALL
    SELECT 'goals outside 0..20',
           count(*)::int FROM public.matches WHERE goals < 0 OR goals > 20
    UNION ALL
    SELECT 'assists outside 0..20',
           count(*)::int FROM public.matches WHERE assists < 0 OR assists > 20
    UNION ALL
    SELECT 'contribution with no minutes',
           count(*)::int FROM public.matches
     WHERE minutes_played = 0 AND (goals > 0 OR assists > 0)
    UNION ALL
    SELECT 'goals above the team score',
           count(*)::int FROM public.matches
     WHERE team_score IS NOT NULL AND goals > team_score
    UNION ALL
    SELECT 'contributions beyond minutes',
           count(*)::int FROM public.matches
     WHERE minutes_played > 0 AND goals + assists > greatest(3, minutes_played / 5)
  LOOP
    IF r.n > 0 THEN
      RAISE NOTICE 'match stats: % existing row(s) would fail "%"', r.n, r.rule;
      total := total + r.n;
    END IF;
  END LOOP;

  IF total = 0 THEN
    RAISE NOTICE 'match stats: every existing row satisfies the new rules; constraints are ready to VALIDATE.';
  ELSE
    RAISE NOTICE 'match stats: % row(s) total need review before VALIDATE CONSTRAINT.', total;
  END IF;
END;
$migration$;


-- ── 4. Post-condition ────────────────────────────────────────
-- The constraints must exist and the RPC must carry its own validation. A
-- migration that silently added nothing would otherwise pass.
DO $migration$
DECLARE
  missing text := '';
  c       text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'matches_minutes_in_range', 'matches_goals_in_range', 'matches_assists_in_range',
    'matches_no_minutes_no_contribution', 'matches_goals_within_team_score',
    'matches_contributions_fit_minutes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.matches'::regclass AND contype = 'c' AND conname = c
    ) THEN
      missing := missing || format(E'\n  %s is absent', c);
    END IF;
  END LOOP;

  IF (SELECT prosrc FROM pg_proc WHERE proname = 'log_match_for_player') NOT LIKE '%could not have happened%'
     AND (SELECT prosrc FROM pg_proc WHERE proname = 'log_match_for_player') NOT LIKE '%is not possible%' THEN
    missing := missing || E'\n  log_match_for_player does not validate its stats';
  END IF;

  -- The checks this migration must not have removed.
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'log_match_for_player') NOT LIKE '%squad_player_is_mine%' THEN
    missing := missing || E'\n  log_match_for_player LOST its departure check from 20260917000005';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'log_match_for_player') NOT LIKE '%is_coach%' THEN
    missing := missing || E'\n  log_match_for_player LOST its coach check';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Match stat validation post-condition failed:%', missing;
  END IF;
END;
$migration$;

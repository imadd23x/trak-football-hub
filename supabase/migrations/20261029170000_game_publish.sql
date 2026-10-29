-- TRAK-289 (Games 7/8, spec TRAK-282): publishing the evaluation closes the game's loop. Each child who played reads
-- their own review, and their guardians read it without the note's text, in copy tables only publish writes, as share
-- writes the plan's (TRAK-286). Strength, scouting and how they scored are never copied. Publishing also writes the
-- result the way the match log does: one match session, who played present, and a match row for each child with an
-- account, through log_match_for_player. It's final: the draft never changes again. In the app only: no email, no push.
--
-- A Games match has no rating (Imad, 28 Oct): after a game there is no number. computed_rating takes null, and every
-- reader of it leaves out a match without one.
--
-- A match made before New event asked the competition (TRAK-288), or saved without Home or Away, gets them at publish
-- (Imad, 29 Oct): the match log needs both, and a started match can't be edited (TRAK-230).

ALTER TABLE public.matches ALTER COLUMN computed_rating DROP NOT NULL;

-- What a child who played and their guardians read: the job, did the job, what was asked, against expectation, the
-- score, and whether there's a note (its text is the child's alone).
CREATE TABLE public.game_review_for_family (
  event_id uuid NOT NULL REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE,
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  our_score smallint NOT NULL,
  their_score smallint NOT NULL,
  job text NOT NULL DEFAULT '',
  did_job text NOT NULL CHECK (did_job IN ('yes', 'partly', 'not_yet')),
  expectation text NOT NULL CHECK (expectation IN ('stretch', 'usual', 'lead')),
  context text[] NOT NULL DEFAULT '{}',
  against_expectation text NOT NULL CHECK (against_expectation IN ('below', 'met', 'above')),
  has_note boolean NOT NULL DEFAULT false,
  -- A child can't read their coach's profile (TRAK-300), so the name travels with the copy.
  coach_name text NOT NULL DEFAULT '',
  -- The match session publish wrote, so a child's match history can tell this match's row (it carries no rating).
  session_id uuid REFERENCES public.coach_sessions(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, squad_player_id)
);

-- The coach's note to a child who played: only that child reads it.
CREATE TABLE public.game_review_for_player (
  event_id uuid NOT NULL,
  squad_player_id uuid NOT NULL,
  note text NOT NULL,
  PRIMARY KEY (event_id, squad_player_id),
  FOREIGN KEY (event_id, squad_player_id) REFERENCES public.game_review_for_family(event_id, squad_player_id) ON DELETE CASCADE
);

ALTER TABLE public.game_review_for_family ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_review_for_player ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.game_review_for_family, public.game_review_for_player FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.game_review_for_family, public.game_review_for_player TO authenticated;
-- The shared plan's rules (TRAK-286): a published, uncancelled match of an academy with Games, the child on the
-- coach's current roster in its squad, with consent; the child themselves, or for the family copy their guardians.
CREATE POLICY "Children and their guardians read the review" ON public.game_review_for_family
  FOR SELECT TO authenticated
  USING (trak_private.family_reads_game_copy(event_id, squad_player_id, true));
CREATE POLICY "Children read their own note" ON public.game_review_for_player
  FOR SELECT TO authenticated
  USING (trak_private.family_reads_game_copy(event_id, squad_player_id, false));

-- Publishes the match's evaluation draft. p_competition and p_home_away are asked only when the match has none.
-- Returns how many children got their review, how many match rows were written, and who was skipped because they can
-- no longer be recorded (the app names them).
CREATE FUNCTION public.publish_game_evaluation(p_event_id uuid, p_competition text DEFAULT NULL, p_home_away text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.coach_calendar_events;
  g public.game_evaluations;
  v_competition text;
  v_home_away text;
  v_skipped uuid[];
  v_session uuid;
  v_coach text;
  v_reviews integer;
  v_logged integer := 0;
  r record;
BEGIN
  SELECT * INTO e FROM public.coach_calendar_events ev
  WHERE ev.id = p_event_id AND ev.coach_user_id = (SELECT auth.uid());
  IF NOT FOUND OR NOT public.is_coach() THEN
    RAISE EXCEPTION 'This match isn''t one of yours' USING ERRCODE = '42501';
  END IF;
  IF NOT public.feature_on('games') THEN
    RAISE EXCEPTION 'Games is switched off for your academy' USING ERRCODE = '42501';
  END IF;
  IF e.event_type <> 'match' THEN
    RAISE EXCEPTION 'Only a match has an evaluation' USING ERRCODE = 'P0001';
  END IF;
  IF e.status = 'cancelled' THEN
    RAISE EXCEPTION 'This match was cancelled, so it has no evaluation' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(e.ends_at, e.starts_at + interval '90 minutes') > now() THEN
    RAISE EXCEPTION 'The evaluation opens at full time' USING ERRCODE = 'P0001';
  END IF;
  -- One publish at a time, and only once.
  SELECT * INTO g FROM public.game_evaluations ge WHERE ge.event_id = e.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save the evaluation before you publish it' USING ERRCODE = 'P0001';
  END IF;
  IF g.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'This evaluation is already published' USING ERRCODE = 'P0001';
  END IF;
  IF g.our_score IS NULL OR g.their_score IS NULL THEN
    RAISE EXCEPTION 'Enter the score before you publish' USING ERRCODE = 'P0001';
  END IF;
  -- Every "Did the plan work?" answer is in: one for each of the plan's goals.
  IF cardinality(g.plan_worked) < COALESCE((SELECT jsonb_array_length(p.goals) FROM public.game_plans p WHERE p.event_id = e.id), 0)
     OR array_position(g.plan_worked, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Answer "Did the plan work?" for every goal before you publish' USING ERRCODE = 'P0001';
  END IF;
  v_competition := COALESCE(e.competition, p_competition);
  IF v_competition IS NULL OR v_competition NOT IN ('league', 'tournament', 'friendly') THEN
    RAISE EXCEPTION 'Pick the competition: league, tournament or friendly' USING ERRCODE = 'P0001';
  END IF;
  v_home_away := COALESCE(e.home_away, p_home_away);
  IF v_home_away IS NULL OR v_home_away NOT IN ('home', 'away') THEN
    RAISE EXCEPTION 'Say whether it was home or away' USING ERRCODE = 'P0001';
  END IF;
  -- A match logged the old way already has its result.
  IF EXISTS (SELECT 1 FROM public.coach_sessions s WHERE s.event_id = e.id) THEN
    RAISE EXCEPTION 'This match was already logged, so publishing can''t write its result again' USING ERRCODE = 'P0001';
  END IF;
  -- Saved on the match, so the result and the event agree. Neither is a change families are emailed about.
  IF e.competition IS NULL OR e.home_away IS NULL THEN
    UPDATE public.coach_calendar_events ev SET competition = v_competition, home_away = v_home_away WHERE ev.id = e.id;
  END IF;

  UPDATE public.game_evaluations ge SET published_at = now() WHERE ge.event_id = e.id;
  v_coach := COALESCE((SELECT btrim(pr.full_name) FROM public.profiles pr WHERE pr.user_id = e.coach_user_id), '');
  -- Who played and can still be recorded gets a review and a result; anyone else is skipped.
  v_skipped := ARRAY(SELECT p.squad_player_id FROM public.game_evaluation_players p
                     WHERE p.event_id = e.id AND p.played AND NOT trak_private.game_plan_player_ok(e.id, p.squad_player_id));

  -- The result as the match log writes it (CoachAddSession): the match's session and who played present, then below a
  -- row for each child with an account. No minutes, no cards and no rating: the evaluation doesn't ask them.
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, squad, event_id, competition, venue, notes)
  VALUES (e.coach_user_id, e.title, 'match', trak_private.event_day(e), e.squad, e.id, initcap(v_competition), initcap(v_home_away),
          g.our_score || '-' || g.their_score)
  RETURNING id INTO v_session;
  INSERT INTO public.session_attendance (session_id, squad_player_id, status)
  SELECT v_session, p.squad_player_id, 'present' FROM public.game_evaluation_players p
  WHERE p.event_id = e.id AND p.played AND p.squad_player_id <> ALL (v_skipped);

  INSERT INTO public.game_review_for_family
    (event_id, squad_player_id, our_score, their_score, job, did_job, expectation, context, against_expectation, has_note, coach_name, session_id)
  SELECT e.id, p.squad_player_id, g.our_score, g.their_score, COALESCE(gp.job, ''), p.did_job, COALESCE(gp.expectation, 'usual'),
         COALESCE(gp.context, '{}'), p.against_expectation,
         EXISTS (SELECT 1 FROM public.game_evaluation_notes n WHERE n.event_id = e.id AND n.squad_player_id = p.squad_player_id), v_coach, v_session
  FROM public.game_evaluation_players p
  LEFT JOIN public.game_plan_players gp ON gp.event_id = e.id AND gp.squad_player_id = p.squad_player_id
  WHERE p.event_id = e.id AND p.played AND p.squad_player_id <> ALL (v_skipped);
  GET DIAGNOSTICS v_reviews = ROW_COUNT;
  INSERT INTO public.game_review_for_player (event_id, squad_player_id, note)
  SELECT e.id, n.squad_player_id, n.note FROM public.game_evaluation_notes n
  WHERE n.event_id = e.id AND n.squad_player_id <> ALL (v_skipped);

  FOR r IN
    SELECT sp.linked_player_id AS user_id, COALESCE(sp.position, '') AS position, COALESCE(sp.age_group, e.squad, '') AS age_group,
           (SELECT count(*) FROM jsonb_array_elements(g.goals) x WHERE x->>'scorer' = p.squad_player_id::text)::integer AS goals,
           (SELECT count(*) FROM jsonb_array_elements(g.goals) x WHERE x->>'assist' = p.squad_player_id::text)::integer AS assists
    FROM public.game_evaluation_players p
    JOIN public.squad_players sp ON sp.id = p.squad_player_id
    WHERE p.event_id = e.id AND p.played AND sp.linked_player_id IS NOT NULL AND p.squad_player_id <> ALL (v_skipped)
  LOOP
    PERFORM public.log_match_for_player(r.user_id, e.opponent, g.our_score, g.their_score, initcap(v_competition), initcap(v_home_away),
      r.position, r.age_group, NULL, r.goals, r.assists, NULL, NULL, NULL, NULL, trak_private.event_day(e), v_session);
    v_logged := v_logged + 1;
  END LOOP;

  RETURN jsonb_build_object('reviews', v_reviews, 'logged', v_logged, 'skipped', to_jsonb(v_skipped));
END;
$$;
REVOKE ALL ON FUNCTION public.publish_game_evaluation(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_game_evaluation(uuid, text, text) TO authenticated;

-- A published evaluation is final, so the match log's editor (20261021120000) refuses its match. Same function, same
-- signature and grants; its body is the 21 Oct one with that one check added.
CREATE OR REPLACE FUNCTION public.edit_logged_match(p_session_id uuid, p_team_score integer, p_opponent_score integer, p_players jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_opponent text;
  v_day date;
  v_rows integer;
  v_goals integer := 0;
  v_assists integer := 0;
  v_item jsonb;
  v_player uuid;
  v_n integer;
  v_rating numeric;
  v_updated integer;
BEGIN
  IF NOT public.is_coach() THEN
    RAISE EXCEPTION 'Not authorised: only a coach can edit a match' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coach_sessions s
                 WHERE s.id = p_session_id AND s.coach_user_id = auth.uid() AND s.session_type = 'match') THEN
    RAISE EXCEPTION 'This is not a match you logged' USING ERRCODE = '42501';
  END IF;
  -- TRAK-289: a match whose Games evaluation is published is final; its result is never edited here.
  IF EXISTS (SELECT 1 FROM public.coach_sessions s JOIN public.game_evaluations g ON g.event_id = s.event_id
             WHERE s.id = p_session_id AND g.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This match''s evaluation is published, so its result is final' USING ERRCODE = 'P0001';
  END IF;
  IF p_team_score IS NULL OR p_opponent_score IS NULL
     OR p_team_score NOT BETWEEN 0 AND 99 OR p_opponent_score NOT BETWEEN 0 AND 99 THEN
    RAISE EXCEPTION 'A score is a whole number from 0 to 99';
  END IF;
  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'The players must be a list';
  END IF;

  SELECT lower(btrim(coalesce(m.opponent, ''))), m.match_date INTO v_opponent, v_day
  FROM public.matches m
  WHERE m.session_id = p_session_id AND m.logged_by = auth.uid() AND m.logged_by_role = 'coach'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No players are logged in this match';
  END IF;
  -- The same lock as log_match_for_player, so a log and an edit of one match take turns.
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || '|' || v_day::text || '|' || v_opponent, 149));

  -- Every player in the match, each once: a score must be the same on every row.
  SELECT count(*) INTO v_rows FROM public.matches m
  WHERE m.session_id = p_session_id AND m.logged_by = auth.uid() AND m.logged_by_role = 'coach';
  IF jsonb_array_length(p_players) <> v_rows
     OR (SELECT count(DISTINCT x->>'user_id') FROM jsonb_array_elements(p_players) x) <> v_rows
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_players) x
                WHERE NOT EXISTS (SELECT 1 FROM public.matches m
                                  WHERE m.session_id = p_session_id AND m.logged_by = auth.uid()
                                    AND m.user_id::text = x->>'user_id')) THEN
    RAISE EXCEPTION 'An edit includes every player in this match, once each';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_player := (v_item->>'user_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.squad_players sp
                   WHERE sp.linked_player_id = v_player AND public.squad_player_is_mine(sp.id)) THEN
      RAISE EXCEPTION 'Not authorised: player % is not in your squad', v_player USING ERRCODE = '42501';
    END IF;
    -- G1: nothing about a child changes without a parent's consent.
    IF EXISTS (SELECT 1 FROM public.squad_players sp
               WHERE sp.linked_player_id = v_player AND public.squad_player_is_mine(sp.id)
                 AND public.squad_player_consent_required(sp.id)) THEN
      RAISE EXCEPTION 'Waiting for parent: player % can''t be edited until a parent approves', v_player USING ERRCODE = '42501';
    END IF;
    FOREACH v_n IN ARRAY ARRAY[(v_item->>'goals')::integer, (v_item->>'assists')::integer] LOOP
      IF v_n IS NULL OR v_n NOT BETWEEN 0 AND 20 THEN
        RAISE EXCEPTION 'Goals and assists are whole numbers from 0 to 20';
      END IF;
    END LOOP;
    IF (v_item->>'goals')::integer > p_team_score THEN
      RAISE EXCEPTION 'A player cannot score more than the team''s %', p_team_score;
    END IF;
    IF coalesce(v_item->>'card', '') NOT IN ('None', 'Yellow', 'Red') THEN
      RAISE EXCEPTION 'A card is None, Yellow or Red';
    END IF;
    v_rating := (v_item->>'computed_rating')::numeric;
    IF v_rating IS NULL OR v_rating NOT BETWEEN 0 AND 10 THEN
      RAISE EXCEPTION 'A match rating is from 0 to 10';
    END IF;
    v_goals := v_goals + (v_item->>'goals')::integer;
    v_assists := v_assists + (v_item->>'assists')::integer;
  END LOOP;

  -- TRAK-149 / TRAK-167: the match adds up. Fewer is fine (own goals, unlisted scorers).
  IF v_goals > p_team_score THEN
    RAISE EXCEPTION '% goals entered, but the team scored %', v_goals, p_team_score;
  END IF;
  IF v_assists > p_team_score THEN
    RAISE EXCEPTION '% assist% entered, but the team scored %', v_assists,
      CASE WHEN v_assists = 1 THEN '' ELSE 's' END, p_team_score;
  END IF;

  UPDATE public.matches m
  SET team_score = p_team_score,
      opponent_score = p_opponent_score,
      goals = (x->>'goals')::integer,
      assists = (x->>'assists')::integer,
      card_received = x->>'card',
      computed_rating = (x->>'computed_rating')::numeric
  FROM jsonb_array_elements(p_players) x
  WHERE m.session_id = p_session_id AND m.logged_by = auth.uid() AND m.logged_by_role = 'coach'
    AND m.user_id::text = x->>'user_id';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$fn$;

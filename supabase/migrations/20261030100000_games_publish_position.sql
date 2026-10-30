-- TRAK-314 (found in TRAK-289's live run, 29 Oct): publishing logged each child's match at their profile's position, so a
-- player who started in goal read "Defender" in their match history. The old match log records the position played, so
-- a starter is now logged at the line of the plan slot they played, by the rule the app's pitch names slots with
-- (lineName() in src/lib/games/formations.ts): slot 1 the keeper, then the back line, the lines between and the front
-- line. Who came on keeps their profile's position. Matches already published stay as they were (Rehearsal FC only).

-- The line a plan slot sits in, for a shape like '4-4-2' (its lines from the back; the keeper comes on top); null for a
-- slot the shape doesn't have.
CREATE FUNCTION trak_private.slot_line(p_shape text, p_slot integer)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_slot = 1 THEN 'Goalkeeper' ELSE (
    SELECT CASE WHEN l.n = 1 THEN 'Defender' WHEN l.n = l.lines THEN 'Forward' ELSE 'Midfielder' END
    FROM (SELECT t.n, 1 + sum(t.c::integer) OVER (ORDER BY t.n) AS last, count(*) OVER () AS lines
          FROM unnest(string_to_array(p_shape, '-')) WITH ORDINALITY AS t(c, n)) l
    WHERE p_slot <= l.last
    ORDER BY l.n LIMIT 1) END;
$$;
REVOKE ALL ON FUNCTION trak_private.slot_line(text, integer) FROM PUBLIC, anon, authenticated;

-- As 20261029170000_game_publish.sql, with the position played.
CREATE OR REPLACE FUNCTION public.publish_game_evaluation(p_event_id uuid, p_competition text DEFAULT NULL, p_home_away text DEFAULT NULL)
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
    -- TRAK-314: a starter at the line they played; who came on, at their profile's position.
    SELECT sp.linked_player_id AS user_id,
           COALESCE(CASE WHEN gp.role = 'starter' THEN trak_private.slot_line(gpl.formation, gp.slot) END, sp.position, '') AS position,
           COALESCE(sp.age_group, e.squad, '') AS age_group,
           (SELECT count(*) FROM jsonb_array_elements(g.goals) x WHERE x->>'scorer' = p.squad_player_id::text)::integer AS goals,
           (SELECT count(*) FROM jsonb_array_elements(g.goals) x WHERE x->>'assist' = p.squad_player_id::text)::integer AS assists
    FROM public.game_evaluation_players p
    JOIN public.squad_players sp ON sp.id = p.squad_player_id
    LEFT JOIN public.game_plan_players gp ON gp.event_id = e.id AND gp.squad_player_id = p.squad_player_id
    LEFT JOIN public.game_plans gpl ON gpl.event_id = e.id
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

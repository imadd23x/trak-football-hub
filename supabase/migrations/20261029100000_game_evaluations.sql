-- TRAK-288 (Games 6/8, spec TRAK-282): the evaluation after full time, as a draft only the match's coach reads. One
-- per match, with a row for each player the coach lists and the coach's note to each player who played in its own
-- table, as for the plan. Publishing (TRAK-289) is the only way out of a draft, and once published nothing changes.
--
-- save_game_evaluation is the only write path: app roles hold SELECT only, so a save is one transaction and the
-- rules that span the tables hold (a scorer played; a note is for a player who played). It opens at full time, as
-- the app shows it (the event's end, or 90 minutes after kick-off). It needs the games switch and a match that isn't
-- cancelled, and it writes rows only for consented children on the coach's roster in the match's squad. How they
-- scored stays the coach's for good: publish copies what each audience reads.
--
-- A match asks its competition in New event (Imad, 28 Oct), so publish reads it from the event. Null for trainings
-- and for matches made before this.

ALTER TABLE public.coach_calendar_events
  ADD COLUMN competition text CHECK (competition IN ('league', 'tournament', 'friendly'));

-- Each of our goals: who scored and who assisted, or null when not recorded (an own goal, a guest player). Fewer
-- scorers than goals is fine, as in the match log (match_scores_add_up); never more. Nobody assists their own goal.
CREATE FUNCTION trak_private.valid_evaluation_goals(value jsonb, our_score smallint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE goal jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(value) > COALESCE(our_score, 0) THEN RETURN false; END IF;
 FOR goal IN SELECT * FROM jsonb_array_elements(value) LOOP
  IF jsonb_typeof(goal) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(goal) k WHERE k NOT IN ('scorer', 'assist')) THEN RETURN false; END IF;
  IF COALESCE(jsonb_typeof(goal->'scorer'), 'null') NOT IN ('string', 'null')
    OR COALESCE(jsonb_typeof(goal->'assist'), 'null') NOT IN ('string', 'null') THEN RETURN false; END IF;
  IF goal->>'assist' = goal->>'scorer' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION trak_private.valid_evaluation_goals(jsonb, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.valid_evaluation_goals(jsonb, smallint) TO authenticated, service_role;

CREATE TABLE public.game_evaluations (
  event_id uuid PRIMARY KEY REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE,
  -- Unset until the coach enters the score.
  our_score smallint CHECK (our_score BETWEEN 0 AND 99),
  their_score smallint CHECK (their_score BETWEEN 0 AND 99),
  goals jsonb NOT NULL DEFAULT '[]',
  how_they_scored text NOT NULL DEFAULT '' CHECK (char_length(how_they_scored) <= 2000),
  -- Did the plan work, for each of the plan's goals in order; null until the coach answers.
  plan_worked text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(plan_worked) <= 3 AND array_remove(plan_worked, NULL) <@ ARRAY['didnt', 'partly', 'worked']),
  saved_at timestamptz NOT NULL DEFAULT now(),
  -- Set by publish (TRAK-289); null while it's a draft.
  published_at timestamptz,
  CONSTRAINT game_evaluations_scorers_add_up CHECK (trak_private.valid_evaluation_goals(goals, our_score))
);

CREATE TABLE public.game_evaluation_players (
  event_id uuid NOT NULL REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE,
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  -- A starter the coach didn't untick, or a bench player who came on. No minutes (Imad, 29 Oct).
  played boolean NOT NULL,
  -- Everyone starts at Yes · Met.
  did_job text NOT NULL DEFAULT 'yes' CHECK (did_job IN ('yes', 'partly', 'not_yet')),
  against_expectation text NOT NULL DEFAULT 'met' CHECK (against_expectation IN ('below', 'met', 'above')),
  PRIMARY KEY (event_id, squad_player_id),
  -- Someone who didn't play is only listed.
  CONSTRAINT game_evaluation_players_unplayed_listed_only
    CHECK (played OR (did_job = 'yes' AND against_expectation = 'met'))
);

-- The coach's note to a player who played. Only that player will read it once it's published (TRAK-289).
CREATE TABLE public.game_evaluation_notes (
  event_id uuid NOT NULL,
  squad_player_id uuid NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  PRIMARY KEY (event_id, squad_player_id),
  FOREIGN KEY (event_id, squad_player_id)
    REFERENCES public.game_evaluation_players(event_id, squad_player_id) ON DELETE CASCADE
);

ALTER TABLE public.game_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_evaluation_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_evaluation_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.game_evaluations, public.game_evaluation_players, public.game_evaluation_notes
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.game_evaluations, public.game_evaluation_players, public.game_evaluation_notes
  TO authenticated;

-- An evaluation's coach is its match's coach. Reads don't need the switch, so switching Games off loses nothing.
CREATE POLICY "Coaches read their own evaluations" ON public.game_evaluations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = game_evaluations.event_id AND e.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Coaches read their own evaluations' players" ON public.game_evaluation_players
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = game_evaluation_players.event_id AND e.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Coaches read their own evaluation notes" ON public.game_evaluation_notes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = game_evaluation_notes.event_id AND e.coach_user_id = (SELECT auth.uid())));

-- The whole draft, as the app holds it, saved in one go. p_players: [{id, played, did_job, against_expectation,
-- note}], one for each player listed; anyone left out loses their row. Returns when it saved.
CREATE FUNCTION public.save_game_evaluation(p_event_id uuid, p_our_score integer, p_their_score integer,
  p_goals jsonb, p_how_they_scored text, p_plan_worked text[], p_players jsonb)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.coach_calendar_events;
  v_published timestamptz;
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
  -- Full time as lib/games/loop.ts works it out.
  IF COALESCE(e.ends_at, e.starts_at + interval '90 minutes') > now() THEN
    RAISE EXCEPTION 'The evaluation opens at full time' USING ERRCODE = 'P0001';
  END IF;

  -- One save at a time for a match, and none once it's published.
  INSERT INTO public.game_evaluations (event_id) VALUES (e.id) ON CONFLICT (event_id) DO NOTHING;
  SELECT g.published_at INTO v_published FROM public.game_evaluations g WHERE g.event_id = e.id FOR UPDATE;
  IF v_published IS NOT NULL THEN
    RAISE EXCEPTION 'This evaluation is published, so it can''t change' USING ERRCODE = 'P0001';
  END IF;

  p_players := COALESCE(p_players, '[]');
  -- 42501 like the match log's consent refusal, so the app can re-check consent and say why.
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_players) AS x(id uuid)
             WHERE x.id IS NULL OR NOT trak_private.game_plan_player_ok(e.id, x.id)) THEN
    RAISE EXCEPTION 'Nothing is recorded about a child until a parent approves, and only for this squad''s players'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_players) AS x(played boolean, note text)
             WHERE x.played IS NOT TRUE AND btrim(COALESCE(x.note, '')) <> '') THEN
    RAISE EXCEPTION 'Only a player who played gets a note' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.game_evaluation_players p WHERE p.event_id = e.id
    AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_players) AS x(id uuid) WHERE x.id = p.squad_player_id);
  INSERT INTO public.game_evaluation_players AS p (event_id, squad_player_id, played, did_job, against_expectation)
    SELECT e.id, x.id, x.played, COALESCE(x.did_job, 'yes'), COALESCE(x.against_expectation, 'met')
    FROM jsonb_to_recordset(p_players) AS x(id uuid, played boolean, did_job text, against_expectation text)
  ON CONFLICT (event_id, squad_player_id) DO UPDATE
    SET played = EXCLUDED.played, did_job = EXCLUDED.did_job, against_expectation = EXCLUDED.against_expectation;
  DELETE FROM public.game_evaluation_notes n WHERE n.event_id = e.id;
  INSERT INTO public.game_evaluation_notes (event_id, squad_player_id, note)
    SELECT e.id, x.id, btrim(x.note) FROM jsonb_to_recordset(p_players) AS x(id uuid, note text)
    WHERE btrim(COALESCE(x.note, '')) <> '';

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_goals, '[]')) AS g,
               LATERAL (VALUES (g->>'scorer'), (g->>'assist')) AS who(id)
             WHERE who.id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM public.game_evaluation_players p
               WHERE p.event_id = e.id AND p.played AND p.squad_player_id::text = who.id)) THEN
    RAISE EXCEPTION 'Scorers and assists are players who played' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.game_evaluations g
  SET our_score = p_our_score, their_score = p_their_score, goals = COALESCE(p_goals, '[]'),
      how_they_scored = COALESCE(p_how_they_scored, ''), plan_worked = COALESCE(p_plan_worked, '{}'), saved_at = now()
  WHERE g.event_id = e.id;
  RETURN now();
END;
$$;
REVOKE ALL ON FUNCTION public.save_game_evaluation(uuid, integer, integer, jsonb, text, text[], jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_game_evaluation(uuid, integer, integer, jsonb, text, text[], jsonb)
  TO authenticated;

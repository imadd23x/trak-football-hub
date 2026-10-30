-- TRAK-319 (Imad, 30 Oct): the job is the player's alone. "There should only be one note, and it's for the player, not
-- the family. The family doesn't need to know the player's job; the player does, because they play."
--
-- Before the match a family reads whether their child starts, is on the bench or isn't in the squad: no job, and not
-- that there's a note. After it, the score and how it went against what was asked: no job, no "did the job", no note
-- line. The child reads their job, and a left-out child the coach's note, from the copies only they can read. The
-- coach's sheet has one box per player: a selected player's job, or a left-out player's note, so a note to a selected
-- player no longer goes out.
--
-- RLS can't hide a column, so the job and "did the job" move to the child's own rows (game_for_player,
-- game_review_for_player). The family columns stay, written blank, so the app that's live while this deploys keeps
-- working; nothing reads them after it.

ALTER TABLE public.game_for_player ADD COLUMN job text NOT NULL DEFAULT '' CHECK (char_length(job) <= 300);
ALTER TABLE public.game_review_for_player
  ADD COLUMN job text NOT NULL DEFAULT '',
  ADD COLUMN did_job text CHECK (did_job IN ('yes', 'partly', 'not_yet')),
  ALTER COLUMN note SET DEFAULT '';
ALTER TABLE public.game_review_for_family ALTER COLUMN did_job DROP NOT NULL;

-- As 20261028180000_game_sharing.sql, with one box per player: a note goes out only to a player who is left out.
CREATE OR REPLACE FUNCTION trak_private.game_copies(p_event_id uuid)
RETURNS TABLE (squad_player_id uuid, copied boolean, role text, job text, note text, goals jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT sp.id,
    gp.role = 'starter'
      OR NOT EXISTS (SELECT 1 FROM public.event_absences a WHERE a.event_id = e.id AND a.squad_player_id = sp.id),
    COALESCE(gp.role, 'bench'), COALESCE(gp.job, ''), CASE WHEN gp.role = 'not_selected' THEN gp.note ELSE '' END,
    COALESCE(plan.goals, '[]'::jsonb)
  FROM public.coach_calendar_events e
  JOIN public.squad_players sp ON sp.coach_user_id = e.coach_user_id
  LEFT JOIN public.game_plans plan ON plan.event_id = e.id
  LEFT JOIN public.game_plan_players gp ON gp.event_id = e.id AND gp.squad_player_id = sp.id
  WHERE e.id = p_event_id
    AND e.coach_user_id = (SELECT auth.uid())
    AND public.squad_player_is_mine(sp.id)
    AND sp.organization_id IS NOT DISTINCT FROM e.organization_id
    AND sp.status <> 'coach_departed'
    AND (e.squad IS NULL OR sp.age_group = e.squad)
    AND NOT public.squad_player_consent_required(sp.id);
$$;

-- As 20261028180000_game_sharing.sql: whose copies a share would change. The family's copy holds the role only; the
-- child's holds the goals, the note and the job.
CREATE OR REPLACE FUNCTION trak_private.game_copy_changes(p_event_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT w.squad_player_id
  FROM trak_private.game_copies(p_event_id) w
  LEFT JOIN public.game_for_family f ON f.event_id = p_event_id AND f.squad_player_id = w.squad_player_id
  LEFT JOIN public.game_for_player p ON p.event_id = p_event_id AND p.squad_player_id = w.squad_player_id
  WHERE CASE WHEN w.copied
    THEN f.squad_player_id IS NULL OR p.squad_player_id IS NULL
      OR f.role IS DISTINCT FROM w.role
      OR (p.goals, p.note, p.job) IS DISTINCT FROM (w.goals, w.note, w.job)
    ELSE f.squad_player_id IS NOT NULL OR p.squad_player_id IS NOT NULL END;
$$;

-- As 20261029214500_games_share_at_and_nudge.sql, with the job in the child's copy and the family's role only.
CREATE OR REPLACE FUNCTION trak_private.write_game_copies(p_event_id uuid, p_at timestamptz)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_changed uuid[] := ARRAY(SELECT trak_private.game_copy_changes(p_event_id));
  v_coach text;
BEGIN
  DELETE FROM public.game_for_family f WHERE f.event_id = p_event_id
    AND f.squad_player_id NOT IN (SELECT w.squad_player_id FROM trak_private.game_copies(p_event_id) w WHERE w.copied);
  DELETE FROM public.game_for_player p WHERE p.event_id = p_event_id
    AND p.squad_player_id NOT IN (SELECT w.squad_player_id FROM trak_private.game_copies(p_event_id) w WHERE w.copied);
  INSERT INTO public.game_for_family AS f (event_id, squad_player_id, role, job, has_note, shared_at)
    SELECT p_event_id, w.squad_player_id, w.role, '', false, p_at
    FROM trak_private.game_copies(p_event_id) w WHERE w.copied
  ON CONFLICT (event_id, squad_player_id) DO UPDATE
    SET role = EXCLUDED.role, job = '', has_note = false,
      changed_at = CASE WHEN f.shared_at <= now() THEN now() ELSE f.changed_at END
    WHERE f.role IS DISTINCT FROM EXCLUDED.role;
  INSERT INTO public.game_for_player AS p (event_id, squad_player_id, goals, note, job, shared_at)
    SELECT p_event_id, w.squad_player_id, w.goals, w.note, w.job, p_at
    FROM trak_private.game_copies(p_event_id) w WHERE w.copied
  ON CONFLICT (event_id, squad_player_id) DO UPDATE
    SET goals = EXCLUDED.goals, note = EXCLUDED.note, job = EXCLUDED.job,
      changed_at = CASE WHEN p.shared_at <= now() THEN now() ELSE p.changed_at END
    WHERE (p.goals, p.note, p.job) IS DISTINCT FROM (EXCLUDED.goals, EXCLUDED.note, EXCLUDED.job);
  UPDATE public.game_for_family f SET shared_at = p_at
  WHERE f.event_id = p_event_id AND f.shared_at > now() AND f.shared_at <> p_at;
  UPDATE public.game_for_player p SET shared_at = p_at
  WHERE p.event_id = p_event_id AND p.shared_at > now() AND p.shared_at <> p_at;
  -- TRAK-300: the name the family reads the plan under. Not a change, so changed_at stays as it is.
  v_coach := COALESCE((SELECT btrim(pr.full_name) FROM public.coach_calendar_events e
    JOIN public.profiles pr ON pr.user_id = e.coach_user_id WHERE e.id = p_event_id), '');
  UPDATE public.game_for_family f SET coach_name = v_coach
  WHERE f.event_id = p_event_id AND f.coach_name IS DISTINCT FROM v_coach;
  RETURN v_changed;
END;
$$;

-- As 20261030100000_games_publish_position.sql, with the job and "did the job" in the child's own review row (one for
-- every child who played, the note there when there is one) and the family's row without them.
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

  -- TRAK-319: the family's review has the score and what was asked, never the job, "did the job" or a note line.
  INSERT INTO public.game_review_for_family
    (event_id, squad_player_id, our_score, their_score, job, did_job, expectation, context, against_expectation, has_note, coach_name, session_id)
  SELECT e.id, p.squad_player_id, g.our_score, g.their_score, '', NULL, COALESCE(gp.expectation, 'usual'),
         COALESCE(gp.context, '{}'), p.against_expectation, false, v_coach, v_session
  FROM public.game_evaluation_players p
  LEFT JOIN public.game_plan_players gp ON gp.event_id = e.id AND gp.squad_player_id = p.squad_player_id
  WHERE p.event_id = e.id AND p.played AND p.squad_player_id <> ALL (v_skipped);
  GET DIAGNOSTICS v_reviews = ROW_COUNT;
  -- The child's own: their job, whether they did it, and the coach's note when there is one.
  INSERT INTO public.game_review_for_player (event_id, squad_player_id, note, job, did_job)
  SELECT e.id, p.squad_player_id, COALESCE(n.note, ''), COALESCE(gp.job, ''), p.did_job
  FROM public.game_evaluation_players p
  LEFT JOIN public.game_plan_players gp ON gp.event_id = e.id AND gp.squad_player_id = p.squad_player_id
  LEFT JOIN public.game_evaluation_notes n ON n.event_id = e.id AND n.squad_player_id = p.squad_player_id
  WHERE p.event_id = e.id AND p.played AND p.squad_player_id <> ALL (v_skipped);

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

-- Copies already out (Rehearsal FC only): the child's copies take their job first, then the family's lose it. A note
-- to a selected player goes, as it would on the next share.
UPDATE public.game_for_player p SET job = f.job
FROM public.game_for_family f
WHERE f.event_id = p.event_id AND f.squad_player_id = p.squad_player_id AND f.job <> '';
UPDATE public.game_for_player p SET note = ''
FROM public.game_for_family f
WHERE f.event_id = p.event_id AND f.squad_player_id = p.squad_player_id AND f.role <> 'not_selected' AND p.note <> '';
UPDATE public.game_for_family SET job = '', has_note = false WHERE job <> '' OR has_note;
INSERT INTO public.game_review_for_player (event_id, squad_player_id, note, job, did_job)
SELECT f.event_id, f.squad_player_id, '', f.job, f.did_job FROM public.game_review_for_family f
ON CONFLICT (event_id, squad_player_id) DO UPDATE SET job = EXCLUDED.job, did_job = EXCLUDED.did_job;
UPDATE public.game_review_for_family SET job = '', did_job = NULL, has_note = false
WHERE job <> '' OR did_job IS NOT NULL OR has_note;

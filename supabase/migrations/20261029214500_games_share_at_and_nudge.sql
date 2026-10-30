-- TRAK-290 (Games 8/8, spec TRAK-282): Share at a time, and the morning-after nudge. No background job.
--
-- Share at a time. Scheduling writes the copies at once, each carrying the time it goes out (shared_at), and the
-- copies' read rules open them from that time, or from kick-off if the match moves before it (the design doc's
-- least(share time, starts_at)). Until then the plan waits: the coach can move the time or share it now, and saving
-- the plan rewrites the waiting copies, so what goes out is the plan as saved (Imad, 29 Oct). Nobody has read a
-- waiting copy, so a rewrite marks nobody Updated, and a waiting plan has no "Changes not shared".
--
-- The morning-after nudge. An evaluation draft's reminder is the first 09:00 after it was saved, on the academy's
-- clock (TRAK-175), stamped with every save (remind_at). The app compares it with the time the page is read.

-- A copy is out from its share time, or from kick-off if the match moved before it.
CREATE FUNCTION trak_private.game_copy_out(p_event_id uuid, p_shared_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = p_event_id AND least(p_shared_at, e.starts_at) <= now());
$$;
REVOKE ALL ON FUNCTION trak_private.game_copy_out(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.game_copy_out(uuid, timestamptz) TO authenticated, service_role;

ALTER POLICY "Children and their guardians read the shared plan" ON public.game_for_family
  USING (trak_private.game_copy_out(event_id, shared_at) AND trak_private.family_reads_game_copy(event_id, squad_player_id, true));
ALTER POLICY "Children read the goals and their own note" ON public.game_for_player
  USING (trak_private.game_copy_out(event_id, shared_at) AND trak_private.family_reads_game_copy(event_id, squad_player_id, false));

-- The checks every share makes (20261028180000_game_sharing.sql), for Share now and Share at alike: the caller's own
-- published, uncancelled match before kick-off, Games on, and a saved plan, held for this share.
CREATE FUNCTION trak_private.game_to_share(p_event_id uuid)
RETURNS public.coach_calendar_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.coach_calendar_events;
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
    RAISE EXCEPTION 'Only a match has a game plan' USING ERRCODE = 'P0001';
  END IF;
  IF e.status = 'cancelled' THEN
    RAISE EXCEPTION 'This match was cancelled, so its plan isn''t shared' USING ERRCODE = 'P0001';
  END IF;
  IF NOT e.published THEN
    RAISE EXCEPTION 'Share the logistics first: publish the match' USING ERRCODE = 'P0001';
  END IF;
  IF e.starts_at <= now() THEN
    RAISE EXCEPTION 'This match has kicked off, so its plan can''t be shared' USING ERRCODE = 'P0001';
  END IF;
  -- One share at a time for a match.
  PERFORM 1 FROM public.game_plans p WHERE p.event_id = e.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save the plan before you share it' USING ERRCODE = 'P0001';
  END IF;
  RETURN e;
END;
$$;
REVOKE ALL ON FUNCTION trak_private.game_to_share(uuid) FROM PUBLIC, anon, authenticated;

-- Writes the copies a share at `p_at` sends, as 20261028210000_game_coach_name.sql's share_game_plan did, and
-- returns the children whose copies changed. A new copy goes out at `p_at` and a waiting one moves to it; a copy
-- already out keeps its time and, if its words change, reads Updated.
CREATE FUNCTION trak_private.write_game_copies(p_event_id uuid, p_at timestamptz)
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
    SELECT p_event_id, w.squad_player_id, w.role, w.job, w.note <> '', p_at
    FROM trak_private.game_copies(p_event_id) w WHERE w.copied
  ON CONFLICT (event_id, squad_player_id) DO UPDATE
    SET role = EXCLUDED.role, job = EXCLUDED.job, has_note = EXCLUDED.has_note,
      changed_at = CASE WHEN f.shared_at <= now() THEN now() ELSE f.changed_at END
    WHERE (f.role, f.job, f.has_note) IS DISTINCT FROM (EXCLUDED.role, EXCLUDED.job, EXCLUDED.has_note);
  INSERT INTO public.game_for_player AS p (event_id, squad_player_id, goals, note, shared_at)
    SELECT p_event_id, w.squad_player_id, w.goals, w.note, p_at
    FROM trak_private.game_copies(p_event_id) w WHERE w.copied
  ON CONFLICT (event_id, squad_player_id) DO UPDATE
    SET goals = EXCLUDED.goals, note = EXCLUDED.note,
      changed_at = CASE WHEN p.shared_at <= now() THEN now() ELSE p.changed_at END
    WHERE (p.goals, p.note) IS DISTINCT FROM (EXCLUDED.goals, EXCLUDED.note);
  UPDATE public.game_for_family f SET shared_at = p_at
  WHERE f.event_id = p_event_id AND f.shared_at > now() AND f.shared_at <> p_at;
  UPDATE public.game_for_player p SET shared_at = p_at
  WHERE p.event_id = p_event_id AND p.shared_at > now() AND p.shared_at <> p_at;
  -- TRAK-300: the name the family reads the note under. Not a change, so changed_at stays as it is.
  v_coach := COALESCE((SELECT btrim(pr.full_name) FROM public.coach_calendar_events e
    JOIN public.profiles pr ON pr.user_id = e.coach_user_id WHERE e.id = p_event_id), '');
  UPDATE public.game_for_family f SET coach_name = v_coach
  WHERE f.event_id = p_event_id AND f.coach_name IS DISTINCT FROM v_coach;
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION trak_private.write_game_copies(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Share now, and Share the changes (20261028180000). From TRAK-290 a plan that waits goes out now, and the log keeps
-- its one share, at this time.
CREATE OR REPLACE FUNCTION public.share_game_plan(p_event_id uuid, p_talked boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.coach_calendar_events := trak_private.game_to_share(p_event_id);
  v_first boolean := NOT EXISTS (SELECT 1 FROM public.game_shares s WHERE s.event_id = e.id);
  v_waiting boolean := EXISTS (SELECT 1 FROM public.game_shares s WHERE s.event_id = e.id AND s.shared_at > now());
  v_changed uuid[];
BEGIN
  IF v_first AND p_talked IS NOT TRUE THEN
    RAISE EXCEPTION 'Talk selection through with the players, face to face, before you share it' USING ERRCODE = 'P0001';
  END IF;
  v_changed := trak_private.write_game_copies(e.id, now());
  IF v_waiting THEN
    UPDATE public.game_shares s SET shared_at = now(),
      changed = (SELECT count(*) FROM public.game_for_family f WHERE f.event_id = e.id)
    WHERE s.event_id = e.id AND s.shared_at > now();
  ELSIF v_first OR cardinality(v_changed) > 0 THEN
    INSERT INTO public.game_shares (event_id, changed) VALUES (e.id, cardinality(v_changed));
  END IF;
  RETURN cardinality(v_changed);
END;
$$;

-- Share at a time. `p_at` is on the academy's clock (TRAK-175), as a time typed in a form is; with no time, a waiting
-- plan is rewritten for the time it has (saving while it waits). Once the plan is out it's Share the changes instead.
-- Returns how many children's copies changed.
CREATE FUNCTION public.schedule_game_plan(p_event_id uuid, p_talked boolean DEFAULT false, p_at timestamp DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.coach_calendar_events := trak_private.game_to_share(p_event_id);
  v_first boolean := NOT EXISTS (SELECT 1 FROM public.game_shares s WHERE s.event_id = e.id);
  v_waiting timestamptz := (SELECT max(s.shared_at) FROM public.game_shares s WHERE s.event_id = e.id AND s.shared_at > now());
  v_at timestamptz := p_at AT TIME ZONE trak_private.academy_time_zone(e.organization_id);
  v_changed uuid[];
BEGIN
  IF NOT v_first AND v_waiting IS NULL THEN
    RAISE EXCEPTION 'It''s already out: share the changes now' USING ERRCODE = 'P0001';
  END IF;
  IF v_first AND p_talked IS NOT TRUE THEN
    RAISE EXCEPTION 'Talk selection through with the players, face to face, before you share it' USING ERRCODE = 'P0001';
  END IF;
  v_at := COALESCE(v_at, v_waiting);
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'Pick when it goes out' USING ERRCODE = 'P0001';
  END IF;
  IF v_at <= now() THEN
    RAISE EXCEPTION 'That time has passed: pick a later one, or share it now' USING ERRCODE = 'P0001';
  END IF;
  IF v_at >= e.starts_at THEN
    RAISE EXCEPTION 'Pick a time before kick-off' USING ERRCODE = 'P0001';
  END IF;
  v_changed := trak_private.write_game_copies(e.id, v_at);
  IF v_first THEN
    INSERT INTO public.game_shares (event_id, shared_at, changed) VALUES (e.id, v_at, cardinality(v_changed));
  ELSE
    UPDATE public.game_shares s SET shared_at = v_at,
      changed = (SELECT count(*) FROM public.game_for_family f WHERE f.event_id = e.id)
    WHERE s.event_id = e.id AND s.shared_at > now();
  END IF;
  RETURN cardinality(v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_game_plan(uuid, boolean, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_game_plan(uuid, boolean, timestamp) TO authenticated;

-- As 20261028223000_games_locked_at_kick_off.sql, for plans that are out: a waiting plan goes out as saved, so it has
-- no changes to share.
CREATE OR REPLACE FUNCTION public.game_plan_changes(p_event_ids uuid[])
RETURNS TABLE (event_id uuid, squad_player_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.id, c.squad_player_id
  FROM public.coach_calendar_events e
  CROSS JOIN LATERAL trak_private.game_copy_changes(e.id) AS c(squad_player_id)
  WHERE e.id = ANY (p_event_ids)
    AND e.coach_user_id = (SELECT auth.uid()) AND public.is_coach()
    AND e.status <> 'cancelled'
    AND EXISTS (SELECT 1 FROM public.game_shares s WHERE s.event_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM public.game_shares s WHERE s.event_id = e.id AND s.shared_at > now());
$$;

-- The morning-after nudge.
ALTER TABLE public.game_evaluations ADD COLUMN remind_at timestamptz;
COMMENT ON COLUMN public.game_evaluations.remind_at IS
  'TRAK-290: the first 09:00 after saved_at on the academy''s clock. From then the draft''s Needs you card is urgent.';

-- The first 09:00 after the save on the academy's clock, so Athens' clock change can't move it.
CREATE FUNCTION trak_private.stamp_evaluation_reminder()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_zone text := trak_private.academy_time_zone(
    (SELECT e.organization_id FROM public.coach_calendar_events e WHERE e.id = NEW.event_id));
  v_local timestamp := NEW.saved_at AT TIME ZONE v_zone;
  v_nine timestamp := date_trunc('day', v_local) + interval '9 hours';
BEGIN
  NEW.remind_at := (CASE WHEN v_local < v_nine THEN v_nine ELSE v_nine + interval '1 day' END) AT TIME ZONE v_zone;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION trak_private.stamp_evaluation_reminder() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_stamp_evaluation_reminder
  BEFORE INSERT OR UPDATE OF saved_at ON public.game_evaluations
  FOR EACH ROW EXECUTE FUNCTION trak_private.stamp_evaluation_reminder();
-- Drafts saved before this migration get theirs too.
UPDATE public.game_evaluations SET saved_at = saved_at;

-- TRAK-360 follow-up (found live on Rehearsal FC, 8 Nov): a coach with one squad doesn't pick a squad when they add a
-- match, so its squad is null. load_default_formation (20261107110000) did nothing for such a match. A match with no
-- squad now belongs to the coach's one squad; a coach with several squads still gets nothing, as there is no way to say
-- which squad's default is meant. Otherwise as before.
CREATE OR REPLACE FUNCTION public.load_default_formation(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.coach_calendar_events;
  v_squad text;
  v_format smallint;
  v_default public.formations;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_coach() THEN
    RAISE EXCEPTION 'Not authorized for this match' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM public.coach_calendar_events e
   WHERE e.id = p_event_id AND e.coach_user_id = auth.uid() AND e.event_type = 'match' AND e.status <> 'cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized for this match' USING ERRCODE = '42501'; END IF;
  IF NOT public.feature_on('season_plan') OR NOT public.feature_on('games') THEN
    RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
  END IF;
  v_squad := coalesce(v_event.squad, (SELECT min(btrim(sp.age_group)) FROM public.squad_players sp
    WHERE sp.coach_user_id = auth.uid() AND sp.status IS DISTINCT FROM 'coach_departed'
    HAVING count(DISTINCT btrim(sp.age_group)) = 1));
  IF v_squad IS NULL OR v_event.starts_at <= now()
     OR EXISTS (SELECT 1 FROM public.game_plan_players g WHERE g.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.formation_copies c WHERE c.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.game_plans p WHERE p.event_id = p_event_id AND p.formation IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce((SELECT p.format FROM public.game_plans p WHERE p.event_id = p_event_id), 11) INTO v_format;
  SELECT * INTO v_default FROM public.formations f
   WHERE f.coach_user_id = auth.uid() AND f.squad = v_squad AND f.format = v_format AND f.is_default;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_result := trak_private.copy_formation(v_default.id, p_event_id, true);
  RETURN v_result || jsonb_build_object('formation', v_default.name);
END $$;

-- TRAK-355 (Season plan 7/18, spec TRAK-348): watch first. Instead of setting a player up now, the coach watches
-- them, and Needs you brings them back by the squad's reminder rule: after 1, 2 or 4 weeks, or after 2 or 4 trainings
-- the player attended (from the register); whatever the rule, after 28 days at the latest. The app works out when
-- from these rows, the register and the academy's time zone (src/lib/watch-first.ts). Nothing goes out while watching.
--
-- The rule is the squad's (the mockup's, one per squad, "after 2 trainings" to start), so it sits on its season plan,
-- which the coach already updates. A watch is one row per player: when it began and who began it. Watching again
-- restarts the clock ("Keep watching"). A player with objectives is set up: they aren't watched, and giving one
-- objectives ends their watch. Only the player's coach reads a watch; nobody writes one but watch_players(), which
-- checks the coach, the squad, consent and the season_plan switch, all or nothing.

ALTER TABLE public.season_plans
  ADD COLUMN watch_rule text NOT NULL DEFAULT 't2' CHECK (watch_rule IN ('w1', 'w2', 'w4', 't2', 't4'));

CREATE TABLE public.player_watches (
  squad_player_id uuid PRIMARY KEY REFERENCES public.squad_players(id) ON DELETE CASCADE,
  since timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.player_watches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_watches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.player_watches TO authenticated;
CREATE POLICY "Coaches read their players' watches" ON public.player_watches
  FOR SELECT TO authenticated
  USING (public.is_coach() AND public.squad_player_is_mine(squad_player_id));

-- Watches the players (Watch first on one, or "Not yet" for everyone), restarting any clock already running. A player
-- with objectives is set up and skipped. Returns how many are watched. One player who can't be watched refuses all.
CREATE FUNCTION public.watch_players(p_squad_player_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_id uuid;
 v_n integer := 0;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_coach() THEN
  RAISE EXCEPTION 'Only a coach watches players' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 FOREACH v_id IN ARRAY coalesce(p_squad_player_ids, '{}') LOOP
  IF v_id IS NULL OR NOT public.squad_player_is_mine(v_id) THEN
   RAISE EXCEPTION 'Not authorized for this squad player' USING ERRCODE = '42501';
  END IF;
  IF trak_private.squad_player_consent_required(v_id) THEN
   RAISE EXCEPTION 'Waiting for consent: nothing is recorded about this player yet' USING ERRCODE = '42501';
  END IF;
  CONTINUE WHEN EXISTS (SELECT 1 FROM public.player_objectives po WHERE po.squad_player_id = v_id AND po.status = 'open');
  INSERT INTO public.player_watches (squad_player_id, since, started_by) VALUES (v_id, now(), auth.uid())
   ON CONFLICT (squad_player_id) DO UPDATE SET since = now(), started_by = auth.uid();
  v_n := v_n + 1;
 END LOOP;
 RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.watch_players(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.watch_players(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.watch_players(uuid[]) IS
  'TRAK-355: watches the coach''s consented players instead of setting them up now, restarting any running clock. Checks the coach, the squad, consent and the season_plan switch.';

-- As TRAK-354 wrote it, and giving a player objectives now ends their watch.
CREATE OR REPLACE FUNCTION public.save_player_objectives(p_squad_player_id uuid, p_objectives jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_list jsonb := coalesce(p_objectives, '[]'::jsonb);
 v_player public.squad_players%ROWTYPE;
 v_shared boolean;
 v_item jsonb;
 v_slot smallint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_coach() OR NOT public.squad_player_is_mine(p_squad_player_id) THEN
  RAISE EXCEPTION 'Not authorized for this squad player' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF trak_private.squad_player_consent_required(p_squad_player_id) THEN
  RAISE EXCEPTION 'Waiting for consent: nothing is recorded about this player yet' USING ERRCODE = '42501';
 END IF;
 IF jsonb_typeof(v_list) <> 'array' THEN
  RAISE EXCEPTION 'Objectives come as a list' USING ERRCODE = '22023';
 END IF;
 IF jsonb_array_length(v_list) > 2 THEN
  RAISE EXCEPTION 'A player works on up to two objectives at once' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e
     WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e -> 'title') IS DISTINCT FROM 'string'
       OR (e ->> 'title') <> btrim(e ->> 'title') OR char_length(e ->> 'title') NOT BETWEEN 1 AND 120
       OR coalesce(e ->> 'source', '') NOT IN ('library', 'own')
       OR (e ? 'season_objective_id' AND jsonb_typeof(e -> 'season_objective_id') NOT IN ('string', 'null')))
   OR (SELECT count(DISTINCT lower(e ->> 'title')) FROM jsonb_array_elements(v_list) e) <> jsonb_array_length(v_list) THEN
  RAISE EXCEPTION 'An objective is one line of 1 to 120 characters, from the library or the coach, each once' USING ERRCODE = '22023';
 END IF;

 -- Locks the player's row, so two saves for one player run one after the other.
 SELECT * INTO v_player FROM public.squad_players sp WHERE sp.id = p_squad_player_id FOR UPDATE;
 IF jsonb_array_length(v_list) > 0 AND (v_player.position IS NULL OR v_player.position NOT IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker')) THEN
  RAISE EXCEPTION 'Give them a position first' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e
     WHERE e ->> 'season_objective_id' IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.season_objectives so JOIN public.season_plans pl ON pl.id = so.plan_id
       WHERE so.id::text = e ->> 'season_objective_id' AND pl.coach_user_id = auth.uid() AND pl.squad = btrim(v_player.age_group))) THEN
  RAISE EXCEPTION 'A supported season objective comes from your plan for this squad' USING ERRCODE = '22023';
 END IF;
 SELECT EXISTS (SELECT 1 FROM public.season_plans pl
   WHERE pl.coach_user_id = auth.uid() AND pl.squad = btrim(v_player.age_group) AND pl.shared_at IS NOT NULL) INTO v_shared;

 -- What's no longer on the list: deleted in a draft, retired once shared.
 IF v_shared THEN
  UPDATE public.player_objectives SET status = 'retired', retired_at = now()
   WHERE squad_player_id = p_squad_player_id AND status = 'open'
     AND lower(title) NOT IN (SELECT lower(e ->> 'title') FROM jsonb_array_elements(v_list) e);
 ELSE
  DELETE FROM public.player_objectives
   WHERE squad_player_id = p_squad_player_id AND status = 'open'
     AND lower(title) NOT IN (SELECT lower(e ->> 'title') FROM jsonb_array_elements(v_list) e);
 END IF;
 -- What stays may name another season objective.
 UPDATE public.player_objectives po SET source = e ->> 'source', season_objective_id = (e ->> 'season_objective_id')::uuid
  FROM jsonb_array_elements(v_list) e
  WHERE po.squad_player_id = p_squad_player_id AND po.status = 'open' AND lower(po.title) = lower(e ->> 'title')
    AND (po.source IS DISTINCT FROM e ->> 'source' OR po.season_objective_id IS DISTINCT FROM (e ->> 'season_objective_id')::uuid);
 -- What's new takes a free place.
 FOR v_item IN SELECT e FROM jsonb_array_elements(v_list) e
   WHERE NOT EXISTS (SELECT 1 FROM public.player_objectives po
     WHERE po.squad_player_id = p_squad_player_id AND po.status = 'open' AND lower(po.title) = lower(e ->> 'title')) LOOP
  SELECT s INTO v_slot FROM unnest(ARRAY[1, 2]::smallint[]) s
   WHERE NOT EXISTS (SELECT 1 FROM public.player_objectives po
     WHERE po.squad_player_id = p_squad_player_id AND po.status = 'open' AND po.slot = s)
   ORDER BY s LIMIT 1;
  INSERT INTO public.player_objectives (squad_player_id, slot, title, source, season_objective_id, created_by)
   VALUES (p_squad_player_id, v_slot, v_item ->> 'title', v_item ->> 'source', (v_item ->> 'season_objective_id')::uuid, auth.uid());
 END LOOP;
 -- TRAK-355: a player with objectives is set up, so no longer watched.
 IF jsonb_array_length(v_list) > 0 THEN
  DELETE FROM public.player_watches WHERE squad_player_id = p_squad_player_id;
 END IF;
END $$;

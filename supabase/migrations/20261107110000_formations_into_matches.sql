-- TRAK-360 (Season plan 12/18, spec TRAK-348): a formation goes into a match's Game plan as a COPY, so later edits to the
-- formation never reach the match, and a formation can be the squad's default for its format.
--
-- A copy is the formation's shape and its starters written to the match's plan and line-up (game_plans,
-- game_plan_players): a draft only the coach reads, like any line-up. What the match already holds stays: its opponent,
-- instructions and each player's job, note, context and expectation. The old starters go to the bench. A starter whose
-- family said "Can't make it" (or whom the coach marked Not attending) goes to Not attending (TRAK-359). A starter who
-- has left the roster, or whose consent isn't in place, is skipped (trak_private.game_plan_player_ok). What was copied,
-- when, and how many weren't coming or were skipped is kept in formation_copies: "Set for matchday" lists it, and the
-- line-up says so. Deleting a formation takes its records and nothing in any match.
--
-- One default per format for a squad: the first time the coach opens the line-up of a match that has none, the default
-- for the match's format loads as a copy. A match of another format gets nothing. Only the functions here write.

ALTER TABLE public.formations ADD COLUMN is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX formations_one_default ON public.formations (coach_user_id, squad, format) WHERE is_default;

-- A formation that changes format is no longer the default for the old one, and doesn't take another's place.
CREATE FUNCTION trak_private.formation_default_follows_format() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.format <> OLD.format THEN NEW.is_default := false; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trak_private.formation_default_follows_format() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER formations_default_follows_format BEFORE UPDATE OF format ON public.formations
  FOR EACH ROW EXECUTE FUNCTION trak_private.formation_default_follows_format();

CREATE TABLE public.formation_copies (
  formation_id uuid NOT NULL REFERENCES public.formations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE,
  copied_at timestamptz NOT NULL DEFAULT now(),
  -- Starters who went to Not attending, and starters skipped (left the roster, or consent not in place).
  not_coming smallint NOT NULL CHECK (not_coming >= 0),
  skipped smallint NOT NULL CHECK (skipped >= 0),
  -- Loaded as the squad's default, not picked by the coach.
  by_default boolean NOT NULL DEFAULT false,
  PRIMARY KEY (formation_id, event_id)
);
CREATE INDEX formation_copies_event ON public.formation_copies (event_id, copied_at);
ALTER TABLE public.formation_copies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.formation_copies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.formation_copies TO authenticated;
CREATE POLICY "Coaches read their own formations' copies" ON public.formation_copies
  FOR SELECT TO authenticated
  USING (public.is_coach() AND EXISTS (SELECT 1 FROM public.formations f
    WHERE f.id = formation_copies.formation_id AND f.coach_user_id = (SELECT auth.uid())));

-- One copy into one match; the public functions check the switches and call it. Returns {placed, not_coming, skipped}.
CREATE FUNCTION trak_private.copy_formation(p_formation_id uuid, p_event_id uuid, p_by_default boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_formation public.formations;
  v_event public.coach_calendar_events;
  v_row record;
  v_placed int := 0;
  v_not_coming int := 0;
  v_skipped int := 0;
BEGIN
  SELECT * INTO v_formation FROM public.formations f
   WHERE f.id = p_formation_id AND f.coach_user_id = auth.uid() AND trak_private.coaches_squad(f.squad);
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized for this formation' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_event FROM public.coach_calendar_events e
   WHERE e.id = p_event_id AND e.coach_user_id = auth.uid() AND e.event_type = 'match' AND e.status <> 'cancelled'
     AND (e.squad IS NULL OR e.squad = v_formation.squad);
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized for this match' USING ERRCODE = '42501'; END IF;
  IF v_event.starts_at <= now() THEN
    RAISE EXCEPTION 'This match has kicked off, so its plan is locked' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.game_plans (event_id, format, formation) VALUES (p_event_id, v_formation.format, v_formation.shape)
   ON CONFLICT (event_id) DO UPDATE SET format = EXCLUDED.format, formation = EXCLUDED.formation;
  -- The old starters go to the bench; everything else on their rows stays.
  UPDATE public.game_plan_players SET role = 'bench', slot = NULL WHERE event_id = p_event_id AND role = 'starter';

  FOR v_row IN
    SELECT fp.slot, fp.squad_player_id,
      EXISTS (SELECT 1 FROM public.event_absences a WHERE a.event_id = p_event_id AND a.squad_player_id = fp.squad_player_id)
        OR EXISTS (SELECT 1 FROM public.game_plan_players g WHERE g.event_id = p_event_id AND g.squad_player_id = fp.squad_player_id
          AND g.role = 'not_attending') AS not_coming
    FROM public.formation_players fp WHERE fp.formation_id = p_formation_id ORDER BY fp.slot
  LOOP
    IF NOT trak_private.game_plan_player_ok(p_event_id, v_row.squad_player_id) THEN
      v_skipped := v_skipped + 1;
    ELSIF v_row.not_coming THEN
      INSERT INTO public.game_plan_players (event_id, squad_player_id, role, slot)
       VALUES (p_event_id, v_row.squad_player_id, 'not_attending', NULL)
       ON CONFLICT (event_id, squad_player_id) DO UPDATE
        SET role = 'not_attending', slot = NULL, job = '', note = '', context = '{}', expectation = 'usual';
      v_not_coming := v_not_coming + 1;
    ELSE
      INSERT INTO public.game_plan_players (event_id, squad_player_id, role, slot)
       VALUES (p_event_id, v_row.squad_player_id, 'starter', v_row.slot)
       ON CONFLICT (event_id, squad_player_id) DO UPDATE SET role = 'starter', slot = EXCLUDED.slot;
      v_placed := v_placed + 1;
    END IF;
  END LOOP;

  INSERT INTO public.formation_copies (formation_id, event_id, not_coming, skipped, by_default)
   VALUES (p_formation_id, p_event_id, v_not_coming, v_skipped, p_by_default)
   ON CONFLICT (formation_id, event_id) DO UPDATE
    SET copied_at = now(), not_coming = EXCLUDED.not_coming, skipped = EXCLUDED.skipped, by_default = EXCLUDED.by_default;
  RETURN jsonb_build_object('event_id', p_event_id, 'placed', v_placed, 'not_coming', v_not_coming, 'skipped', v_skipped);
END $$;
REVOKE ALL ON FUNCTION trak_private.copy_formation(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- "Use for matches": a copy of one formation into each of the chosen matches, all or none. The app asks before it
-- replaces a saved line-up. Returns one {event_id, placed, not_coming, skipped} per match.
CREATE FUNCTION public.use_formation_for_matches(p_formation_id uuid, p_event_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_event uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_coach() THEN
    RAISE EXCEPTION 'Not authorized for this formation' USING ERRCODE = '42501';
  END IF;
  IF NOT public.feature_on('season_plan') OR NOT public.feature_on('games') THEN
    RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
  END IF;
  IF p_event_ids IS NULL OR coalesce(array_length(p_event_ids, 1), 0) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Pick between 1 and 50 matches' USING ERRCODE = '22023';
  END IF;
  FOR v_event IN SELECT DISTINCT e FROM unnest(p_event_ids) e LOOP
    v_results := v_results || jsonb_build_array(trak_private.copy_formation(p_formation_id, v_event, false));
  END LOOP;
  RETURN v_results;
END $$;

-- "Make default" / "Remove default": one default per format for the squad.
CREATE FUNCTION public.set_default_formation(p_id uuid, p_default boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_formation public.formations;
BEGIN
  SELECT * INTO v_formation FROM public.formations f
   WHERE f.id = p_id AND f.coach_user_id = auth.uid() AND public.is_coach() AND trak_private.coaches_squad(f.squad);
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized for this formation' USING ERRCODE = '42501'; END IF;
  IF NOT public.feature_on('season_plan') THEN
    RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
  END IF;
  IF p_default IS NULL THEN RAISE EXCEPTION 'Default or not' USING ERRCODE = '22023'; END IF;
  IF p_default THEN
    UPDATE public.formations SET is_default = false
     WHERE coach_user_id = v_formation.coach_user_id AND squad = v_formation.squad AND format = v_formation.format AND is_default;
  END IF;
  UPDATE public.formations SET is_default = p_default WHERE id = p_id;
END $$;

-- The first time the coach opens the line-up of a match that has none, the default for the match's format loads as a
-- copy. Returns {event_id, placed, not_coming, skipped, formation}, or null when nothing loads: the match already has
-- a line-up, a shape, or a copy; it has no squad or default for its format; or it has kicked off.
CREATE FUNCTION public.load_default_formation(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event public.coach_calendar_events;
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
  IF v_event.squad IS NULL OR v_event.starts_at <= now()
     OR EXISTS (SELECT 1 FROM public.game_plan_players g WHERE g.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.formation_copies c WHERE c.event_id = p_event_id)
     OR EXISTS (SELECT 1 FROM public.game_plans p WHERE p.event_id = p_event_id AND p.formation IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce((SELECT p.format FROM public.game_plans p WHERE p.event_id = p_event_id), 11) INTO v_format;
  SELECT * INTO v_default FROM public.formations f
   WHERE f.coach_user_id = auth.uid() AND f.squad = v_event.squad AND f.format = v_format AND f.is_default;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_result := trak_private.copy_formation(v_default.id, p_event_id, true);
  RETURN v_result || jsonb_build_object('formation', v_default.name);
END $$;

REVOKE ALL ON FUNCTION public.use_formation_for_matches(uuid, uuid[]), public.set_default_formation(uuid, boolean),
  public.load_default_formation(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.use_formation_for_matches(uuid, uuid[]), public.set_default_formation(uuid, boolean),
  public.load_default_formation(uuid) TO authenticated;
COMMENT ON FUNCTION public.use_formation_for_matches(uuid, uuid[]) IS
  'TRAK-360: copies one formation into each chosen upcoming match of its squad (shape and starters), keeping the match''s other fields.';
COMMENT ON FUNCTION public.load_default_formation(uuid) IS
  'TRAK-360: loads the squad''s default formation for the match''s format into a match with no line-up, once.';

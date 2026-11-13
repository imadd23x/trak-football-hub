-- TRAK-453 (11 Nov walk-through): Undo after a formation is copied into a match. A copy replaces the match's format, shape
-- and starters, and resets the job and note of a starter who is not coming. So each copy now keeps what the match held
-- before it (its plan row and every player row) in a table no app role can read, and undo_formation_copy puts it back
-- and removes the copy's record. The saved formation is never touched. Copies made before this migration have no
-- snapshot, so they cannot be undone.
CREATE TABLE public.formation_copy_snapshots (
  formation_id uuid NOT NULL,
  event_id uuid NOT NULL,
  before jsonb NOT NULL,
  PRIMARY KEY (formation_id, event_id),
  FOREIGN KEY (formation_id, event_id) REFERENCES public.formation_copies (formation_id, event_id) ON DELETE CASCADE
);
ALTER TABLE public.formation_copy_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.formation_copy_snapshots FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trak_private.copy_formation(p_formation_id uuid, p_event_id uuid, p_by_default boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_formation public.formations;
  v_event public.coach_calendar_events;
  v_row record;
  v_placed int := 0;
  v_not_coming int := 0;
  v_skipped int := 0;
  v_before jsonb;
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

  -- TRAK-453: what the match held before this copy, so Undo can put it back (its plan row and every player row).
  v_before := jsonb_build_object(
    'plan', (SELECT to_jsonb(g) FROM public.game_plans g WHERE g.event_id = p_event_id),
    'players', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.game_plan_players p WHERE p.event_id = p_event_id), '[]'::jsonb));

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
  INSERT INTO public.formation_copy_snapshots (formation_id, event_id, before) VALUES (p_formation_id, p_event_id, v_before)
   ON CONFLICT (formation_id, event_id) DO UPDATE SET before = EXCLUDED.before;
  RETURN jsonb_build_object('event_id', p_event_id, 'placed', v_placed, 'not_coming', v_not_coming, 'skipped', v_skipped);
END $$;


-- "Undo" after Use for a match: each chosen match goes back to what it held before the copy, all or none. Only the
-- formation's coach, the same switches as the copy, and not after kick-off. A match whose plan has been shared since
-- cannot be undone, because families may already have read it.
CREATE FUNCTION public.undo_formation_copy(p_formation_id uuid, p_event_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_formation public.formations;
  v_event public.coach_calendar_events;
  v_snapshot jsonb;
  v_id uuid;
  v_undone int := 0;
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
  SELECT * INTO v_formation FROM public.formations f
   WHERE f.id = p_formation_id AND f.coach_user_id = auth.uid() AND trak_private.coaches_squad(f.squad);
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized for this formation' USING ERRCODE = '42501'; END IF;

  FOR v_id IN SELECT DISTINCT e FROM unnest(p_event_ids) e LOOP
    SELECT * INTO v_event FROM public.coach_calendar_events e
     WHERE e.id = v_id AND e.coach_user_id = auth.uid() AND e.event_type = 'match' AND e.status <> 'cancelled';
    IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized for this match' USING ERRCODE = '42501'; END IF;
    IF v_event.starts_at <= now() THEN
      RAISE EXCEPTION 'This match has kicked off, so its plan is locked' USING ERRCODE = 'P0001';
    END IF;
    SELECT s.before INTO v_snapshot FROM public.formation_copy_snapshots s
     WHERE s.formation_id = p_formation_id AND s.event_id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'There is no copy to undo' USING ERRCODE = 'P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.game_shares gs WHERE gs.event_id = v_id) THEN
      RAISE EXCEPTION 'This plan has been shared, so the copy cannot be undone' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.game_plan_players WHERE event_id = v_id;
    IF jsonb_typeof(v_snapshot->'plan') = 'object' THEN
      UPDATE public.game_plans g SET format = r.format, formation = r.formation
        FROM jsonb_populate_record(NULL::public.game_plans, v_snapshot->'plan') r WHERE g.event_id = v_id;
    ELSE
      DELETE FROM public.game_plans WHERE event_id = v_id;
    END IF;
    INSERT INTO public.game_plan_players
      SELECT * FROM jsonb_populate_recordset(NULL::public.game_plan_players, v_snapshot->'players');
    DELETE FROM public.formation_copies WHERE formation_id = p_formation_id AND event_id = v_id;
    v_undone := v_undone + 1;
  END LOOP;
  RETURN jsonb_build_object('undone', v_undone);
END $$;

REVOKE ALL ON FUNCTION public.undo_formation_copy(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_formation_copy(uuid, uuid[]) TO authenticated;
COMMENT ON FUNCTION public.undo_formation_copy(uuid, uuid[]) IS
  'TRAK-453: puts each chosen match back to what it held before the formation was copied into it, and removes the copy''s record.';

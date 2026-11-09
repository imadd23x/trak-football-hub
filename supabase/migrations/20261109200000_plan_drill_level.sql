-- TRAK-391 (Drill Library 6/11, parent TRAK-384): Add to training. A Library drill joins a plan at the level the coach
-- set on its page (Easier / Harder), so a saved plan keeps each Library drill's level: 0 is the easiest, 7 the hardest
-- (LEVELS in the app, src/lib/training/library/fit.ts). Only a Trak drill has a level; every other practice, and every
-- plan saved before this, has none. Drafts carry it inside their body, as they carry the rest.
--
-- save_training_plan() is as before (20261103030000_training_parts.sql), plus the level. Same arguments, so it is
-- replaced in place and keeps its grants; they are said again below all the same.

ALTER TABLE public.training_plan_practices
  ADD COLUMN trak_level smallint CHECK (trak_level IS NULL OR (trak_level BETWEEN 0 AND 7 AND source = 'trak'));

-- ── Saving a plan ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_training_plan(p_event_id uuid, p_practices jsonb, p_note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  e public.coach_calendar_events;
  p jsonb;
  v_position smallint := 0;
  v_source text;
  v_drill uuid;
BEGIN
  SELECT * INTO e FROM public.coach_calendar_events ev
  WHERE ev.id = p_event_id AND ev.coach_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This training is not on your schedule' USING ERRCODE = 'P0001';
  END IF;
  IF e.event_type <> 'training' THEN
    RAISE EXCEPTION 'Only a training has a training plan' USING ERRCODE = 'P0001';
  END IF;
  IF e.status = 'cancelled' THEN
    RAISE EXCEPTION 'This training was cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_practices) IS DISTINCT FROM 'array' OR jsonb_array_length(p_practices) = 0 THEN
    RAISE EXCEPTION 'Add a practice before saving the plan' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_practices) > 12 THEN
    RAISE EXCEPTION 'A plan holds at most 12 practices' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.training_plans (event_id, note) VALUES (e.id, COALESCE(btrim(p_note), ''))
  ON CONFLICT (event_id) DO UPDATE SET updated_at = now(), note = EXCLUDED.note;
  DELETE FROM public.training_plan_practices t WHERE t.event_id = e.id;

  FOR p IN SELECT value FROM jsonb_array_elements(p_practices) LOOP
    IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'A practice must be an object' USING ERRCODE = '22023';
    END IF;
    v_position := v_position + 1;
    v_source := COALESCE(p->>'source', 'own');
    v_drill := NULLIF(p->>'drill_id', '')::uuid;
    IF v_source = 'own' AND COALESCE((p->>'save_to_drills')::boolean, false) THEN
      INSERT INTO public.coach_drills (name, minutes, how, tell, area, numbers, direction, targets, conditions,
        part_type, players_kind, group_size)
      VALUES (p->>'name', (p->>'minutes')::smallint, COALESCE(p->>'how', ''), COALESCE(p->>'tell', ''),
              COALESCE(p->>'area', ''), COALESCE(p->>'numbers', ''), COALESCE(p->>'direction', ''),
              COALESCE(p->>'targets', ''), COALESCE(p->>'conditions', ''),
              p->>'part_type', p->>'players_kind', (p->>'group_size')::smallint)
      RETURNING id INTO v_drill;
      v_source := 'drill';
    END IF;
    INSERT INTO public.training_plan_practices (event_id, position, name, minutes, how, tell, area, numbers, direction,
      targets, conditions, source, drill_id, library_session, part, part_type, trak_drill, players_kind, group_size, trak_level)
    VALUES (e.id, v_position, p->>'name', (p->>'minutes')::smallint, COALESCE(p->>'how', ''), COALESCE(p->>'tell', ''),
            COALESCE(p->>'area', ''), COALESCE(p->>'numbers', ''), COALESCE(p->>'direction', ''),
            COALESCE(p->>'targets', ''), COALESCE(p->>'conditions', ''), v_source, v_drill, p->>'library_session',
            COALESCE(p->>'part', ''), p->>'part_type', p->>'trak_drill', p->>'players_kind', (p->>'group_size')::smallint,
            (p->>'trak_level')::smallint);
  END LOOP;

  DELETE FROM public.training_plan_drafts d WHERE d.event_id = e.id;
END
$fn$;
REVOKE ALL ON FUNCTION public.save_training_plan(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_training_plan(uuid, jsonb, text) TO authenticated;

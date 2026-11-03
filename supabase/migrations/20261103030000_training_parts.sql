-- TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): a plan is a list of parts. Each practice keeps the part
-- it fills (its name as the coach calls it, and which of Trak's part types it is, or 'own'), which of Trak's drills it
-- is when it is one (source 'trak', the app's drill shelf), and how many players it takes (for Who's here, step 4).
-- My drills keep their part and player numbers too. A plan keeps one optional note for the coach. A draft is kept
-- apart from the plan (training_plan_drafts), so a draft never shows as planned anywhere: Home's Today card, View,
-- Past trainings. Only the training's coach reads or writes either; writes need the academy's training switch on and
-- the coach's own open training, as plans' do.

-- Trak's part types, in the planner's order; 'own' is a part the coach named.
CREATE FUNCTION public.training_part_type_known(t text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT t IN ('warmup', 'passing', 'rondo', 'functional', 'game', 'setpieces', 'finishing', 'cooldown', 'own')
$$;

ALTER TABLE public.training_plan_practices
  ADD COLUMN part text NOT NULL DEFAULT '' CHECK (char_length(part) <= 40),
  ADD COLUMN part_type text CHECK (part_type IS NULL OR public.training_part_type_known(part_type)),
  ADD COLUMN trak_drill text CHECK (trak_drill IS NULL OR char_length(trak_drill) BETWEEN 1 AND 40),
  ADD COLUMN players_kind text CHECK (players_kind IS NULL OR players_kind IN ('any', 'pairs', 'groups', 'teams')),
  ADD COLUMN group_size smallint CHECK (group_size IS NULL OR group_size BETWEEN 2 AND 12),
  DROP CONSTRAINT training_plan_practices_source_check,
  ADD CONSTRAINT training_plan_practices_source_check CHECK (source IN ('own', 'drill', 'library', 'trak')),
  ADD CONSTRAINT training_plan_practices_trak_drill CHECK ((trak_drill IS NOT NULL) = (source = 'trak'));

ALTER TABLE public.coach_drills
  ADD COLUMN part_type text CHECK (part_type IS NULL OR public.training_part_type_known(part_type)),
  ADD COLUMN players_kind text CHECK (players_kind IS NULL OR players_kind IN ('any', 'pairs', 'groups', 'teams')),
  ADD COLUMN group_size smallint CHECK (group_size IS NULL OR group_size BETWEEN 2 AND 12);

ALTER TABLE public.training_plans
  ADD COLUMN note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500);

-- ── Drafts ───────────────────────────────────────────────────────────────────
-- The planner as the coach left it: its parts (body, the app's own shape, at most 64 kB) and the step they stopped at.
CREATE TABLE public.training_plan_drafts (
  event_id uuid PRIMARY KEY REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  step smallint NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 12),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND pg_column_size(body) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_plan_drafts_coach ON public.training_plan_drafts (coach_user_id, updated_at DESC);
CREATE TRIGGER training_plan_drafts_updated_at BEFORE UPDATE ON public.training_plan_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.training_plan_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_plan_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.training_plan_drafts TO authenticated;

CREATE POLICY "Coaches read their own plan drafts" ON public.training_plan_drafts
  FOR SELECT TO authenticated
  USING (coach_user_id = (SELECT auth.uid()));
CREATE POLICY "Coaches start drafts for their own trainings" ON public.training_plan_drafts
  FOR INSERT TO authenticated
  WITH CHECK (coach_user_id = (SELECT auth.uid()) AND public.is_coach() AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_plan_drafts.event_id AND e.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Coaches change their own plan drafts" ON public.training_plan_drafts
  FOR UPDATE TO authenticated
  USING (coach_user_id = (SELECT auth.uid()))
  WITH CHECK (coach_user_id = (SELECT auth.uid()) AND public.is_coach() AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_plan_drafts.event_id AND e.coach_user_id = (SELECT auth.uid())));
-- A draft can always be thrown away by its coach, switch on or off.
CREATE POLICY "Coaches delete their own plan drafts" ON public.training_plan_drafts
  FOR DELETE TO authenticated
  USING (coach_user_id = (SELECT auth.uid()));

CREATE POLICY "Training switch and an open training gate draft inserts" ON public.training_plan_drafts
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('training')) AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_plan_drafts.event_id AND e.event_type = 'training' AND e.status <> 'cancelled'));
CREATE POLICY "Training switch and an open training gate draft updates" ON public.training_plan_drafts
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('training')) AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_plan_drafts.event_id AND e.event_type = 'training' AND e.status <> 'cancelled'))
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('training')) AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_plan_drafts.event_id AND e.event_type = 'training' AND e.status <> 'cancelled'));

-- ── Saving a plan ────────────────────────────────────────────────────────────
-- As before (TRAK-295), plus each practice's part, part_type, trak_drill, players_kind and group_size, and the plan's
-- note. Saving throws the training's draft away: the plan is what's kept now.
DROP FUNCTION public.save_training_plan(uuid, jsonb);
CREATE FUNCTION public.save_training_plan(p_event_id uuid, p_practices jsonb, p_note text DEFAULT '')
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
      targets, conditions, source, drill_id, library_session, part, part_type, trak_drill, players_kind, group_size)
    VALUES (e.id, v_position, p->>'name', (p->>'minutes')::smallint, COALESCE(p->>'how', ''), COALESCE(p->>'tell', ''),
            COALESCE(p->>'area', ''), COALESCE(p->>'numbers', ''), COALESCE(p->>'direction', ''),
            COALESCE(p->>'targets', ''), COALESCE(p->>'conditions', ''), v_source, v_drill, p->>'library_session',
            COALESCE(p->>'part', ''), p->>'part_type', p->>'trak_drill', p->>'players_kind', (p->>'group_size')::smallint);
  END LOOP;

  DELETE FROM public.training_plan_drafts d WHERE d.event_id = e.id;
END
$fn$;
REVOKE ALL ON FUNCTION public.save_training_plan(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_training_plan(uuid, jsonb, text) TO authenticated;

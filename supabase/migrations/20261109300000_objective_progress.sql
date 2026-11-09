-- TRAK-365 (Season plan 17/18, spec TRAK-348): objectives in the evaluation. An evaluation also says how each open
-- objective of a player is going: Not yet, Some progress or On track. Met closes the objective (kept, its place free
-- again); the coach can add another, up to two open at once. An objective that gets Not yet in three evaluations in a
-- row is stuck, and the coach chooses: Make it simpler (an easier version replaces it), Keep going, or Swap it
-- (retire it and pick another). Each choice is recorded.
--
-- Coach-only, like player_objectives: the player's coach reads progress and choices, and nothing writes them but
-- publish_evaluation_with_objectives() (progress, Met, added objectives, all with the ratings, or none of it) and
-- resolve_stuck_objective(). Players and families see nothing new until TRAK-366.

-- ── Met ────────────────────────────────────────────────────────────────────
-- An objective is open, retired (removed after sharing) or met. retired_at is when it closed, whichever way.
ALTER TABLE public.player_objectives
  DROP CONSTRAINT player_objectives_retired_with_date,
  DROP CONSTRAINT player_objectives_status_check,
  ADD CONSTRAINT player_objectives_status_check CHECK (status IN ('open', 'retired', 'met')),
  ADD CONSTRAINT player_objectives_closed_with_date CHECK ((status <> 'open') = (retired_at IS NOT NULL));
COMMENT ON COLUMN public.player_objectives.retired_at IS
  'When the objective closed: retired after sharing, or met (TRAK-365). Null while it is open.';

-- ── Progress, one row per objective per evaluation ──────────────────────────
CREATE TABLE public.objective_progress (
  evaluation_id uuid NOT NULL REFERENCES public.season_evaluations(id) ON DELETE CASCADE,
  player_objective_id uuid NOT NULL REFERENCES public.player_objectives(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('not_yet', 'some_progress', 'on_track', 'met')),
  PRIMARY KEY (evaluation_id, player_objective_id)
);
CREATE INDEX objective_progress_objective_idx ON public.objective_progress (player_objective_id);
ALTER TABLE public.objective_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.objective_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.objective_progress TO authenticated;
CREATE POLICY "Coaches read their players' progress" ON public.objective_progress
  FOR SELECT TO authenticated
  USING (public.is_coach() AND EXISTS (SELECT 1 FROM public.player_objectives po
    WHERE po.id = objective_progress.player_objective_id AND public.squad_player_is_mine(po.squad_player_id)));

-- ── What the coach chose for a stuck objective ──────────────────────────────
-- after_evaluation_id is the latest evaluation when the coach chose: the Not yets before it no longer count, so an
-- objective is stuck again only after three more in a row.
CREATE TABLE public.objective_stuck_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_objective_id uuid NOT NULL REFERENCES public.player_objectives(id) ON DELETE CASCADE,
  after_evaluation_id uuid NOT NULL REFERENCES public.season_evaluations(id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (choice IN ('simpler', 'keep_going', 'swap')),
  new_objective_id uuid REFERENCES public.player_objectives(id) ON DELETE SET NULL,
  chosen_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objective_stuck_choices_once UNIQUE (player_objective_id, after_evaluation_id)
);
CREATE INDEX objective_stuck_choices_new_idx ON public.objective_stuck_choices (new_objective_id) WHERE new_objective_id IS NOT NULL;
ALTER TABLE public.objective_stuck_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.objective_stuck_choices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.objective_stuck_choices TO authenticated;
CREATE POLICY "Coaches read their players' stuck choices" ON public.objective_stuck_choices
  FOR SELECT TO authenticated
  USING (public.is_coach() AND EXISTS (SELECT 1 FROM public.player_objectives po
    WHERE po.id = objective_stuck_choices.player_objective_id AND public.squad_player_is_mine(po.squad_player_id)));

-- The Not yets in a row an objective has now: those since its last better answer and since the coach last chose.
CREATE FUNCTION trak_private.objective_not_yet_streak(p_objective uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH p AS (
  SELECT e.due_on, pr.status FROM public.objective_progress pr JOIN public.season_evaluations e ON e.id = pr.evaluation_id
   WHERE pr.player_objective_id = p_objective),
 since AS (
  SELECT greatest(
   coalesce((SELECT max(p.due_on) FROM p WHERE p.status <> 'not_yet'), '-infinity'::date),
   coalesce((SELECT max(e.due_on) FROM public.objective_stuck_choices c JOIN public.season_evaluations e ON e.id = c.after_evaluation_id
              WHERE c.player_objective_id = p_objective), '-infinity'::date)) AS d)
 SELECT count(*)::integer FROM p, since WHERE p.status = 'not_yet' AND p.due_on > since.d
$$;
REVOKE ALL ON FUNCTION trak_private.objective_not_yet_streak(uuid) FROM PUBLIC, anon, authenticated;

-- The caller's open objectives that are stuck: three Not yets in a row. Needs you shows a card for each.
CREATE FUNCTION public.stuck_player_objectives()
RETURNS TABLE (player_objective_id uuid, squad_player_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT po.id, po.squad_player_id FROM public.player_objectives po
  WHERE auth.uid() IS NOT NULL AND public.is_coach() AND public.feature_on('season_plan')
    AND po.status = 'open' AND public.squad_player_is_mine(po.squad_player_id)
    AND NOT trak_private.squad_player_consent_required(po.squad_player_id)
    AND trak_private.objective_not_yet_streak(po.id) >= 3
$$;
REVOKE ALL ON FUNCTION public.stuck_player_objectives() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stuck_player_objectives() TO authenticated;

-- ── Publish, with the objectives ───────────────────────────────────────────
-- p_objectives: one object per player that has objectives, {squad_player_id, progress: [{player_objective_id, status}],
-- add: [title]}. Every open objective of a published player gets a status (not_yet, some_progress, on_track or met),
-- once. Met closes it, and its place is free for an added objective in the same evaluation. An added objective is the
-- coach's own, one line of 1 to 120 characters, for a placed player, and a player keeps at most two open. The ratings
-- go through publish_evaluation() in the same transaction, so a refusal anywhere writes nothing.
CREATE FUNCTION public.publish_evaluation_with_objectives(p_plan_id uuid, p_due_on date, p_players jsonb, p_objectives jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_list jsonb := coalesce(p_objectives, '[]'::jsonb);
 v_result jsonb;
 v_evaluation uuid;
 v_player uuid;
 v_entry jsonb;
 v_progress jsonb;
 v_row jsonb;
 v_open uuid[];
 v_seen uuid[];
 v_oid uuid;
 v_status text;
 v_title text;
 v_slot smallint;
 v_position text;
BEGIN
 IF jsonb_typeof(v_list) <> 'array' THEN
  RAISE EXCEPTION 'Objectives come as a list' USING ERRCODE = '22023';
 END IF;
 v_result := public.publish_evaluation(p_plan_id, p_due_on, p_players);
 v_evaluation := (v_result ->> 'evaluation_id')::uuid;

 -- Only for players in this evaluation, each once.
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e
     WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e -> 'squad_player_id') IS DISTINCT FROM 'string'
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_players) p WHERE p ->> 'squad_player_id' = e ->> 'squad_player_id'))
   OR (SELECT count(DISTINCT e ->> 'squad_player_id') FROM jsonb_array_elements(v_list) e) <> jsonb_array_length(v_list) THEN
  RAISE EXCEPTION 'Objectives are for players in this evaluation, each once' USING ERRCODE = '22023';
 END IF;

 FOR v_player IN SELECT (p ->> 'squad_player_id')::uuid FROM jsonb_array_elements(p_players) p LOOP
  SELECT e INTO v_entry FROM jsonb_array_elements(v_list) e WHERE e ->> 'squad_player_id' = v_player::text;
  v_progress := coalesce(v_entry -> 'progress', '[]'::jsonb);
  IF jsonb_typeof(v_progress) <> 'array' OR jsonb_typeof(coalesce(v_entry -> 'add', '[]'::jsonb)) <> 'array' THEN
   RAISE EXCEPTION 'Progress and added objectives come as lists' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(po.id), '{}') INTO v_open FROM public.player_objectives po
   WHERE po.squad_player_id = v_player AND po.status = 'open';
  v_seen := '{}';
  FOR v_row IN SELECT e FROM jsonb_array_elements(v_progress) e LOOP
   IF jsonb_typeof(v_row) <> 'object' OR jsonb_typeof(v_row -> 'player_objective_id') IS DISTINCT FROM 'string'
     OR coalesce(v_row ->> 'status', '') NOT IN ('not_yet', 'some_progress', 'on_track', 'met') THEN
    RAISE EXCEPTION 'Each objective gets Not yet, Some progress, On track or Met' USING ERRCODE = '22023';
   END IF;
   v_oid := (v_row ->> 'player_objective_id')::uuid;
   IF NOT v_oid = ANY (v_open) OR v_oid = ANY (v_seen) THEN
    RAISE EXCEPTION 'Progress is for a player''s open objectives, each once' USING ERRCODE = '22023';
   END IF;
   v_seen := v_seen || v_oid;
   v_status := v_row ->> 'status';
   INSERT INTO public.objective_progress (evaluation_id, player_objective_id, status) VALUES (v_evaluation, v_oid, v_status);
   IF v_status = 'met' THEN
    UPDATE public.player_objectives SET status = 'met', retired_at = now() WHERE id = v_oid;
   END IF;
  END LOOP;
  IF cardinality(v_open) <> cardinality(v_seen) THEN
   RAISE EXCEPTION 'Say how each of a player''s objectives is going' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_entry -> 'add', '[]'::jsonb)) a WHERE jsonb_typeof(a) <> 'string') THEN
   RAISE EXCEPTION 'An objective is one line of 1 to 120 characters' USING ERRCODE = '22023';
  END IF;
  FOR v_title IN SELECT e FROM jsonb_array_elements_text(coalesce(v_entry -> 'add', '[]'::jsonb)) e LOOP
   IF v_title <> btrim(v_title) OR char_length(v_title) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'An objective is one line of 1 to 120 characters' USING ERRCODE = '22023';
   END IF;
   SELECT sp.position INTO v_position FROM public.squad_players sp WHERE sp.id = v_player;
   IF v_position IS NULL OR v_position NOT IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker') THEN
    RAISE EXCEPTION 'Give them a position first' USING ERRCODE = '22023';
   END IF;
   IF EXISTS (SELECT 1 FROM public.player_objectives po
       WHERE po.squad_player_id = v_player AND po.status = 'open' AND lower(po.title) = lower(v_title)) THEN
    RAISE EXCEPTION 'They are already working on that objective' USING ERRCODE = '22023';
   END IF;
   SELECT s INTO v_slot FROM unnest(ARRAY[1, 2]::smallint[]) s
    WHERE NOT EXISTS (SELECT 1 FROM public.player_objectives po
      WHERE po.squad_player_id = v_player AND po.status = 'open' AND po.slot = s)
    ORDER BY s LIMIT 1;
   IF v_slot IS NULL THEN
    RAISE EXCEPTION 'A player works on up to two objectives at once' USING ERRCODE = '22023';
   END IF;
   INSERT INTO public.player_objectives (squad_player_id, slot, title, source, created_by)
    VALUES (v_player, v_slot, v_title, 'own', auth.uid());
  END LOOP;
 END LOOP;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.publish_evaluation_with_objectives(uuid, date, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_evaluation_with_objectives(uuid, date, jsonb, jsonb) TO authenticated;
COMMENT ON FUNCTION public.publish_evaluation_with_objectives(uuid, date, jsonb, jsonb) IS
  'TRAK-365: publish_evaluation() plus each open objective''s progress, Met, and added objectives; all or nothing.';

-- ── What the coach chooses for a stuck objective ────────────────────────────
-- simpler: p_title is the easier version; it takes the old one's place (same season objective), which is retired.
-- keep_going: the objective stays; three more Not yets in a row make it stuck again.
-- swap: the objective is retired, and its place is free for the coach to pick another.
CREATE FUNCTION public.resolve_stuck_objective(p_player_objective_id uuid, p_choice text, p_title text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_obj public.player_objectives%ROWTYPE;
 v_evaluation uuid;
 v_new uuid;
BEGIN
 -- The same refusal for another coach's objective as for one that doesn't exist.
 SELECT * INTO v_obj FROM public.player_objectives po WHERE po.id = p_player_objective_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT public.is_coach() OR NOT public.squad_player_is_mine(v_obj.squad_player_id) THEN
  RAISE EXCEPTION 'Not authorized for this objective' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF trak_private.squad_player_consent_required(v_obj.squad_player_id) THEN
  RAISE EXCEPTION 'Waiting for consent: nothing is recorded about this player yet' USING ERRCODE = '42501';
 END IF;
 IF p_choice IS NULL OR p_choice NOT IN ('simpler', 'keep_going', 'swap') THEN
  RAISE EXCEPTION 'Choose Make it simpler, Keep going or Swap it' USING ERRCODE = '22023';
 END IF;
 IF v_obj.status <> 'open' OR trak_private.objective_not_yet_streak(v_obj.id) < 3 THEN
  RAISE EXCEPTION 'This objective isn''t stuck' USING ERRCODE = 'P0001';
 END IF;
 SELECT e.id INTO v_evaluation FROM public.objective_progress pr JOIN public.season_evaluations e ON e.id = pr.evaluation_id
  WHERE pr.player_objective_id = v_obj.id ORDER BY e.due_on DESC LIMIT 1;

 IF p_choice = 'simpler' THEN
  IF p_title IS NULL OR p_title <> btrim(p_title) OR char_length(p_title) NOT BETWEEN 1 AND 120 THEN
   RAISE EXCEPTION 'An objective is one line of 1 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF lower(p_title) = lower(v_obj.title) THEN
   RAISE EXCEPTION 'Write an easier version, not the same one' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.player_objectives po
      WHERE po.squad_player_id = v_obj.squad_player_id AND po.status = 'open' AND lower(po.title) = lower(p_title)) THEN
   RAISE EXCEPTION 'They are already working on that objective' USING ERRCODE = '22023';
  END IF;
 END IF;
 IF p_choice IN ('simpler', 'swap') THEN
  UPDATE public.player_objectives SET status = 'retired', retired_at = now() WHERE id = v_obj.id;
 END IF;
 IF p_choice = 'simpler' THEN
  INSERT INTO public.player_objectives (squad_player_id, slot, title, source, season_objective_id, created_by)
   VALUES (v_obj.squad_player_id, v_obj.slot, p_title, 'own', v_obj.season_objective_id, auth.uid())
   RETURNING id INTO v_new;
 END IF;
 INSERT INTO public.objective_stuck_choices (player_objective_id, after_evaluation_id, choice, new_objective_id, chosen_by)
  VALUES (v_obj.id, v_evaluation, p_choice, v_new, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.resolve_stuck_objective(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_stuck_objective(uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.resolve_stuck_objective(uuid, text, text) IS
  'TRAK-365: the coach''s choice for an objective with three Not yets in a row: simpler (an easier version), keep going, or swap.';

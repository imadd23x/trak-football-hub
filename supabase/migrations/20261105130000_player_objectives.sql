-- TRAK-354 (Season plan 6/18, spec TRAK-348): player objectives. Each consented, placed player works on up to two
-- open objectives at once: one of the six for their position (the library) or the coach's own. A library objective
-- can name the season objective it supports. No position, no objective, and no midfielder fallback.
--
-- Coach-only for now: the player's coach reads them, and nobody writes them but save_player_objectives(), which saves
-- a player's list in one go and checks the coach, the squad, consent, the season_plan switch and the position, as
-- set_player_position() does. Players and families come with TRAK-366.
--
-- Removing an objective deletes it while the squad's plan is a draft. Once the plan is shared it is retired with its
-- date instead (the spec's rule; TRAK-356 builds Remove), so what was shared keeps its history. Two places per
-- player, each held by at most one open objective, so two saves can't race to a third.

CREATE TABLE public.player_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot IN (1, 2)),
  title text NOT NULL CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 120),
  source text NOT NULL CHECK (source IN ('library', 'own')),
  -- Deleting a season objective in a draft leaves the player's objective, supporting nothing.
  season_objective_id uuid REFERENCES public.season_objectives(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'retired')),
  retired_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_objectives_retired_with_date CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX player_objectives_two_open ON public.player_objectives (squad_player_id, slot) WHERE status = 'open';
CREATE UNIQUE INDEX player_objectives_open_once ON public.player_objectives (squad_player_id, lower(title)) WHERE status = 'open';
CREATE INDEX player_objectives_season_objective ON public.player_objectives (season_objective_id);

-- The player's coach reads them; nobody writes them but the function.
ALTER TABLE public.player_objectives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_objectives FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.player_objectives TO authenticated;
CREATE POLICY "Coaches read their players' objectives" ON public.player_objectives
  FOR SELECT TO authenticated
  USING (public.is_coach() AND public.squad_player_is_mine(squad_player_id));

-- Saves a player's objectives: a JSON list of up to two {title, source, season_objective_id}, replacing the open
-- ones. One already open under the same title (in any case) is kept. The same refusal for a player who isn't the
-- caller's as for one who doesn't exist. An empty list removes them all.
CREATE FUNCTION public.save_player_objectives(p_squad_player_id uuid, p_objectives jsonb)
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
END $$;
REVOKE ALL ON FUNCTION public.save_player_objectives(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_player_objectives(uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.save_player_objectives(uuid, jsonb) IS
  'TRAK-354: saves a player''s open objectives (up to two). Checks the coach, the squad, consent, the season_plan switch and the position.';

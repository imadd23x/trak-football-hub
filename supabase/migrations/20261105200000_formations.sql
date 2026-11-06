-- TRAK-357 (Season plan 9/18, spec TRAK-348): Squad › Formations, the coach's whiteboard of saved line-ups for a
-- squad. A formation has a name, a format (11, 9, 7 or 5 a side) and a shape from Matches' rule
-- (trak_private.formation_fits), and its starters, each in one of the shape's places. Everyone else is on the bench.
-- Matches will copy a formation in (TRAK-360); editing it later never changes a match.
--
-- Coach-only, as the season plan is: the formation's coach reads it, and nobody writes it but the functions here,
-- which check the coach and the squad, the season_plan switch, and that each starter is a consented player in that
-- squad, once. Delete takes the formation and its starters and nothing else.
--
-- A squad starts with three formations (Tarek, 5 Nov: the mockup's, saved for them). start_formations() saves them
-- once per squad, never twice, even after they're all deleted; the app picks their starters by position.

CREATE TABLE public.formations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  squad text NOT NULL CHECK (char_length(squad) BETWEEN 1 AND 40 AND squad = btrim(squad)),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 32),
  format smallint NOT NULL CHECK (format IN (5, 7, 9, 11)),
  shape text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT formations_shape_fits CHECK (trak_private.formation_fits(shape, format))
);
CREATE UNIQUE INDEX formations_name_once ON public.formations (coach_user_id, squad, lower(name));
CREATE TRIGGER formations_updated_at BEFORE UPDATE ON public.formations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- One row per starter: a place on the pitch, held by one player, who starts once.
CREATE TABLE public.formation_players (
  formation_id uuid NOT NULL REFERENCES public.formations(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 11),
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  PRIMARY KEY (formation_id, slot),
  CONSTRAINT formation_players_once UNIQUE (formation_id, squad_player_id)
);
CREATE INDEX formation_players_player ON public.formation_players (squad_player_id);

-- Which squads have had their first three, so they come once. Only the function reads or writes it.
CREATE TABLE public.formation_starts (
  coach_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  squad text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coach_user_id, squad)
);

ALTER TABLE public.formations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formation_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formation_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.formations, public.formation_players, public.formation_starts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.formations, public.formation_players TO authenticated;
CREATE POLICY "Coaches read their own formations" ON public.formations
  FOR SELECT TO authenticated
  USING (public.is_coach() AND coach_user_id = (SELECT auth.uid()));
CREATE POLICY "Coaches read their own formations' starters" ON public.formation_players
  FOR SELECT TO authenticated
  USING (public.is_coach() AND EXISTS (SELECT 1 FROM public.formations f
    WHERE f.id = formation_players.formation_id AND f.coach_user_id = (SELECT auth.uid())));

-- Saves a formation, new (p_id null) or the caller's own, replacing its starters: a list of {slot, squad_player_id}.
-- Returns its id. A squad never changes. The same refusal for a formation that isn't the caller's as for one that
-- doesn't exist.
CREATE FUNCTION public.save_formation(p_id uuid, p_squad text, p_name text, p_format smallint, p_shape text, p_starters jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_list jsonb := coalesce(p_starters, '[]'::jsonb);
 v_id uuid := p_id;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_coach() OR p_squad IS NULL OR NOT trak_private.coaches_squad(p_squad) THEN
  RAISE EXCEPTION 'Not authorized for this squad' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.formations f
     WHERE f.id = v_id AND f.coach_user_id = auth.uid() AND f.squad = p_squad) THEN
  RAISE EXCEPTION 'Not authorized for this formation' USING ERRCODE = '42501';
 END IF;
 IF p_name IS NULL OR p_name <> btrim(p_name) OR char_length(p_name) NOT BETWEEN 1 AND 32 THEN
  RAISE EXCEPTION 'A formation''s name is one line of 1 to 32 characters' USING ERRCODE = '22023';
 END IF;
 IF p_format IS NULL OR p_format NOT IN (5, 7, 9, 11) OR p_shape IS NULL OR NOT trak_private.formation_fits(p_shape, p_format) THEN
  RAISE EXCEPTION 'A formation is 11, 9, 7 or 5 a side, in a shape that fits it' USING ERRCODE = '22023';
 END IF;
 IF jsonb_typeof(v_list) <> 'array'
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e
     WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e -> 'slot') IS DISTINCT FROM 'number'
       OR jsonb_typeof(e -> 'squad_player_id') IS DISTINCT FROM 'string'
       OR (e ->> 'slot') !~ '^[0-9]{1,2}$' OR (e ->> 'slot')::int NOT BETWEEN 1 AND p_format)
   OR (SELECT count(DISTINCT e ->> 'slot') FROM jsonb_array_elements(v_list) e) <> jsonb_array_length(v_list)
   OR (SELECT count(DISTINCT e ->> 'squad_player_id') FROM jsonb_array_elements(v_list) e) <> jsonb_array_length(v_list) THEN
  RAISE EXCEPTION 'Each starter takes one of the format''s places, and starts once' USING ERRCODE = '22023';
 END IF;
 -- Each starter is a consented player on the caller's current roster in this squad.
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e
     WHERE NOT EXISTS (SELECT 1 FROM public.squad_players sp
       WHERE sp.id::text = e ->> 'squad_player_id' AND sp.coach_user_id = auth.uid() AND public.squad_player_is_mine(sp.id)
         AND sp.status IS DISTINCT FROM 'coach_departed' AND btrim(sp.age_group) = p_squad
         AND NOT trak_private.squad_player_consent_required(sp.id))) THEN
  RAISE EXCEPTION 'A starter is a consented player in this squad' USING ERRCODE = '42501';
 END IF;

 IF v_id IS NULL THEN
  INSERT INTO public.formations (coach_user_id, squad, name, format, shape)
   VALUES (auth.uid(), p_squad, p_name, p_format, p_shape) RETURNING id INTO v_id;
 ELSE
  UPDATE public.formations SET name = p_name, format = p_format, shape = p_shape WHERE id = v_id;
  DELETE FROM public.formation_players WHERE formation_id = v_id;
 END IF;
 INSERT INTO public.formation_players (formation_id, slot, squad_player_id)
  SELECT v_id, (e ->> 'slot')::smallint, (e ->> 'squad_player_id')::uuid FROM jsonb_array_elements(v_list) e;
 RETURN v_id;
END $$;

CREATE FUNCTION public.delete_formation(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_coach() OR NOT EXISTS (SELECT 1 FROM public.formations f
     WHERE f.id = p_id AND f.coach_user_id = auth.uid() AND trak_private.coaches_squad(f.squad)) THEN
  RAISE EXCEPTION 'Not authorized for this formation' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 DELETE FROM public.formations WHERE id = p_id;
END $$;

-- Saves a squad's first formations (up to three: {name, format, shape, starters}) and returns true, once per squad.
-- Every later call returns false and saves nothing. One bad formation saves none of them.
CREATE FUNCTION public.start_formations(p_squad text, p_formations jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_item jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_coach() OR p_squad IS NULL OR NOT trak_private.coaches_squad(p_squad) THEN
  RAISE EXCEPTION 'Not authorized for this squad' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF jsonb_typeof(p_formations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_formations) > 3
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_formations) e WHERE jsonb_typeof(e) <> 'object') THEN
  RAISE EXCEPTION 'A squad starts with up to three formations' USING ERRCODE = '22023';
 END IF;
 -- The squad's mark, taken first, so two first visits can't both start it.
 INSERT INTO public.formation_starts (coach_user_id, squad) VALUES (auth.uid(), p_squad) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 FOR v_item IN SELECT e FROM jsonb_array_elements(p_formations) e LOOP
  PERFORM public.save_formation(NULL, p_squad, v_item ->> 'name', (v_item ->> 'format')::smallint, v_item ->> 'shape', v_item -> 'starters');
 END LOOP;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.save_formation(uuid, text, text, smallint, text, jsonb), public.delete_formation(uuid),
  public.start_formations(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_formation(uuid, text, text, smallint, text, jsonb), public.delete_formation(uuid),
  public.start_formations(text, jsonb) TO authenticated;
COMMENT ON FUNCTION public.save_formation(uuid, text, text, smallint, text, jsonb) IS
  'TRAK-357: saves one of the coach''s formations for a squad and its starters. Checks the coach, the squad, the season_plan switch and each starter.';
COMMENT ON FUNCTION public.start_formations(text, jsonb) IS
  'TRAK-357: saves a squad''s first three formations, once per squad, never twice.';

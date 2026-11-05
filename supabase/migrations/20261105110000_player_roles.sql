-- TRAK-353 (Season plan 5/18, spec TRAK-348): Can also play and roles. Beside a player's main position the coach keeps
-- up to two of the other three positions the player can cover, and any number of roles: the presets for the
-- positions they play, or the coach's own. Formations and the match line-up (9/18, 10/18) read Can also play to tell
-- who is out of position.
--
-- Both are coach-only: one row per player per choice, read by the player's coach and written only through
-- save_player_position_and_roles(), which saves the panel in one go and checks the coach, the squad, consent and the
-- season_plan switch, as set_player_position() does. A role the coach writes is free text, so it stays one trimmed
-- line of up to 60 characters, up to 30 a player, and is never shown to families. The coach's own roles are the
-- non-preset roles across their players, so a new one shows for their other players with no table of its own.
-- Only main-position changes are kept as history (Tarek, 5 Nov).

CREATE TABLE public.squad_player_also_plays (
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  position text NOT NULL CHECK (position IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (squad_player_id, position)
);

CREATE TABLE public.squad_player_roles (
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = btrim(role) AND char_length(role) BETWEEN 1 AND 60),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (squad_player_id, role)
);

-- The player's coach reads both; nobody writes them but the function.
ALTER TABLE public.squad_player_also_plays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.squad_player_also_plays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.squad_player_also_plays TO authenticated;
CREATE POLICY "Coaches read their players' Can also play" ON public.squad_player_also_plays
  FOR SELECT TO authenticated
  USING (public.is_coach() AND public.squad_player_is_mine(squad_player_id));

ALTER TABLE public.squad_player_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.squad_player_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.squad_player_roles TO authenticated;
CREATE POLICY "Coaches read their players' roles" ON public.squad_player_roles
  FOR SELECT TO authenticated
  USING (public.is_coach() AND public.squad_player_is_mine(squad_player_id));

-- A player's main position can't also be one they could also play: a Positions tap onto one drops it from the list.
-- Otherwise as TRAK-352 wrote it.
CREATE OR REPLACE FUNCTION public.set_player_position(p_squad_player_id uuid, p_position text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_from text;
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
 IF p_position IS NULL OR p_position NOT IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker') THEN
  RAISE EXCEPTION 'A position is Goalkeeper, Defender, Midfielder or Attacker' USING ERRCODE = '22023';
 END IF;
 SELECT sp.position INTO v_from FROM public.squad_players sp WHERE sp.id = p_squad_player_id FOR UPDATE;
 IF v_from IS NOT DISTINCT FROM p_position THEN RETURN p_position; END IF;
 UPDATE public.squad_players SET position = p_position WHERE id = p_squad_player_id;
 DELETE FROM public.squad_player_also_plays WHERE squad_player_id = p_squad_player_id AND position = p_position;
 INSERT INTO public.squad_position_history (squad_player_id, from_position, to_position, changed_by)
  VALUES (p_squad_player_id, v_from, p_position, auth.uid());
 RETURN p_position;
END $$;

-- Saves the panel: the main position (kept in its history when it moves), Can also play and roles, replacing what
-- was there. The same refusal for a player who isn't the caller's as for one who doesn't exist. No list means none.
CREATE FUNCTION public.save_player_position_and_roles(p_squad_player_id uuid, p_position text, p_also_plays text[], p_roles text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_also text[] := coalesce(p_also_plays, '{}');
 v_roles text[] := coalesce(p_roles, '{}');
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
 IF p_position IS NULL OR p_position NOT IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker') THEN
  RAISE EXCEPTION 'A position is Goalkeeper, Defender, Midfielder or Attacker' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM unnest(v_also) a WHERE a IS NULL OR a NOT IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker'))
   OR (SELECT count(DISTINCT a) FROM unnest(v_also) a) <> cardinality(v_also) THEN
  RAISE EXCEPTION 'Can also play is Goalkeeper, Defender, Midfielder or Attacker, each once' USING ERRCODE = '22023';
 END IF;
 IF cardinality(v_also) > 2 THEN
  RAISE EXCEPTION 'Can also play is up to two positions' USING ERRCODE = '22023';
 END IF;
 IF p_position = ANY (v_also) THEN
  RAISE EXCEPTION 'The main position can''t also be a Can also play' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM unnest(v_roles) r WHERE r IS NULL OR r <> btrim(r) OR char_length(r) NOT BETWEEN 1 AND 60)
   OR (SELECT count(DISTINCT lower(r)) FROM unnest(v_roles) r) <> cardinality(v_roles) THEN
  RAISE EXCEPTION 'A role is one line of 1 to 60 characters, each once' USING ERRCODE = '22023';
 END IF;
 IF cardinality(v_roles) > 30 THEN
  RAISE EXCEPTION 'A player has up to 30 roles' USING ERRCODE = '22023';
 END IF;

 -- Locks the player's row, so two saves for one player run one after the other.
 PERFORM public.set_player_position(p_squad_player_id, p_position);
 DELETE FROM public.squad_player_also_plays WHERE squad_player_id = p_squad_player_id AND position <> ALL (v_also);
 INSERT INTO public.squad_player_also_plays (squad_player_id, position, added_by)
  SELECT p_squad_player_id, a, auth.uid() FROM unnest(v_also) a ON CONFLICT DO NOTHING;
 DELETE FROM public.squad_player_roles WHERE squad_player_id = p_squad_player_id AND role <> ALL (v_roles);
 INSERT INTO public.squad_player_roles (squad_player_id, role, added_by)
  SELECT p_squad_player_id, r, auth.uid() FROM unnest(v_roles) r ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.save_player_position_and_roles(uuid, text, text[], text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_player_position_and_roles(uuid, text, text[], text[]) TO authenticated;
COMMENT ON FUNCTION public.save_player_position_and_roles(uuid, text, text[], text[]) IS
  'TRAK-353: saves a player''s main position, Can also play (up to two) and roles in one go. Checks the coach, the squad, consent and the season_plan switch.';

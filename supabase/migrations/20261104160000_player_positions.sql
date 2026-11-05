-- TRAK-352 (Season plan 4/18, spec TRAK-348): positions. The academy's roster carries no position, so the coach
-- places every consented player: Goalkeeper, Defender, Midfielder or Attacker (shown GK, DEF, MID, ATT). There is no
-- midfielder fallback anywhere. A position already on a row counts as placed (on 4 Nov the 94 live ones were
-- rehearsal seed data, none from a roster); the coach can change it.
--
-- A position is written only through set_player_position(). It checks the coach, the squad, consent and the
-- season_plan switch, and keeps every change in squad_position_history: from, to, who and when. Coaches could
-- update the column directly until now (no screen did), so a trigger closes that path for app roles. The function,
-- operators and other server functions still write it.
--
-- The set-up's first question, "Do you know where they play yet?", is kept on the season plan: Not yet saves with
-- nobody placed, and TRAK-355's reminder reads it.

ALTER TABLE public.season_plans
  ADD COLUMN positions_known text CHECK (positions_known IN ('yes', 'some', 'not_yet'));

CREATE TABLE public.squad_position_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  from_position text,
  to_position text NOT NULL CHECK (to_position IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker')),
  -- Kept when the coach's account goes; the change stays in the player's history.
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX squad_position_history_player ON public.squad_position_history (squad_player_id, changed_at);

-- The player's coach reads the history; nobody writes it but set_player_position().
ALTER TABLE public.squad_position_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.squad_position_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.squad_position_history TO authenticated;
CREATE POLICY "Coaches read their players' position history" ON public.squad_position_history
  FOR SELECT TO authenticated
  USING (public.is_coach() AND public.squad_player_is_mine(squad_player_id));

-- An app role changes a position only through set_player_position(), which runs as its owner.
CREATE FUNCTION trak_private.squad_position_through_function() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('authenticated', 'anon') AND NEW.position IS DISTINCT FROM OLD.position THEN
  RAISE EXCEPTION 'A position is set with set_player_position()' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trak_private.squad_position_through_function() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER squad_players_position_through_function BEFORE UPDATE OF position ON public.squad_players
  FOR EACH ROW EXECUTE FUNCTION trak_private.squad_position_through_function();

-- Places one player. The same refusal for a player who isn't the caller's as for one who doesn't exist. Setting
-- the position a player already has changes nothing and writes no history.
CREATE FUNCTION public.set_player_position(p_squad_player_id uuid, p_position text)
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
 INSERT INTO public.squad_position_history (squad_player_id, from_position, to_position, changed_by)
  VALUES (p_squad_player_id, v_from, p_position, auth.uid());
 RETURN p_position;
END $$;
REVOKE ALL ON FUNCTION public.set_player_position(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_player_position(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.set_player_position(uuid, text) IS
  'TRAK-352: the only way an app role places a player. Checks the coach, the squad, consent and the season_plan switch; keeps every change.';

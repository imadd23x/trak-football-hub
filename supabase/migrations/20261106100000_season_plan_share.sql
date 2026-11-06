-- TRAK-356 (Season plan 8/18, spec TRAK-348): Share. The coach shares the season plan once, at the end of the set-up;
-- after that the set-up never comes back. Edits save straight away, and the plan lists what changed since it was last
-- shared until the coach shares the changes (Tarek, 6 Nov: a list of changes, not a copy, because players and
-- families see nothing of the plan in the app until TRAK-366, which adds a copy per share for their screens). The
-- list holds the season dates, the season objectives and each player's objectives; positions, roles, watches and the
-- reminder aren't on it (Tarek, 6 Nov).
--
-- Once the plan is shared, removing a season objective retires it with its date, as save_player_objectives() already
-- does for a player's (TRAK-354), so both keep their history; before that, deleting really deletes. Share needs both
-- season dates. At the first share only, when there's something to tell (an open season objective or player
-- objective), the coach confirms they talked it through face to face, as Matches' share_game_plan() asks.

-- A retired season objective stays, with when it was added and removed. Only open ones hold one of the three places.
ALTER TABLE public.season_objectives
  ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'retired')),
  ADD COLUMN retired_at timestamptz,
  ADD CONSTRAINT season_objectives_retired_with_date CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  DROP CONSTRAINT season_objectives_one_per_place;
CREATE UNIQUE INDEX season_objectives_one_open_per_place ON public.season_objectives (plan_id, place) WHERE status = 'open';

-- When the plan was last shared (the first share sets shared_at too), and what changed since: 'dates' and
-- 'season_objectives', and the players whose objectives changed. Trak keeps them; the coach never writes them.
ALTER TABLE public.season_plans
  ADD COLUMN last_shared_at timestamptz,
  ADD COLUMN unshared_parts text[] NOT NULL DEFAULT '{}' CHECK (unshared_parts <@ ARRAY['dates', 'season_objectives']::text[]),
  ADD COLUMN unshared_players uuid[] NOT NULL DEFAULT '{}';

-- TRAK-350's rule, plus the new columns: a coach writes a plan's squad once and its dates after, never its owner,
-- when it was shared or what's waiting to be shared. Once shared, new dates wait to be shared.
CREATE OR REPLACE FUNCTION trak_private.season_plan_fixed_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('authenticated', 'anon') THEN
  IF TG_OP = 'INSERT' THEN
   IF NEW.shared_at IS NOT NULL OR NEW.last_shared_at IS NOT NULL OR NEW.unshared_parts <> '{}' OR NEW.unshared_players <> '{}' THEN
    RAISE EXCEPTION 'A season plan starts as a draft' USING ERRCODE = '42501';
   END IF;
  ELSIF NEW.coach_user_id IS DISTINCT FROM OLD.coach_user_id OR NEW.squad IS DISTINCT FROM OLD.squad
    OR NEW.shared_at IS DISTINCT FROM OLD.shared_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.last_shared_at IS DISTINCT FROM OLD.last_shared_at OR NEW.unshared_parts IS DISTINCT FROM OLD.unshared_parts
    OR NEW.unshared_players IS DISTINCT FROM OLD.unshared_players THEN
   RAISE EXCEPTION 'Only a season plan''s dates change' USING ERRCODE = '42501';
  END IF;
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.shared_at IS NOT NULL
   AND (NEW.starts_on IS DISTINCT FROM OLD.starts_on OR NEW.ends_on IS DISTINCT FROM OLD.ends_on)
   AND NOT 'dates' = ANY (NEW.unshared_parts) THEN
  NEW.unshared_parts := array_append(NEW.unshared_parts, 'dates');
 END IF;
 RETURN NEW;
END $$;

-- An objective starts open and keeps its plan and its place. Removing one from a shared plan retires it, and Trak
-- stamps when; a draft's is deleted instead. A retired one stays as it was.
CREATE OR REPLACE FUNCTION trak_private.season_objective_fixed_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.status <> 'open' OR NEW.retired_at IS NOT NULL THEN
   RAISE EXCEPTION 'A season objective starts open' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.place IS DISTINCT FROM OLD.place THEN
  RAISE EXCEPTION 'A season objective keeps its plan and its place' USING ERRCODE = '42501';
 END IF;
 IF OLD.status = 'retired' THEN
  RAISE EXCEPTION 'A removed season objective is kept as it was' USING ERRCODE = '42501';
 END IF;
 IF NEW.status = 'retired' THEN
  IF NOT EXISTS (SELECT 1 FROM public.season_plans p WHERE p.id = NEW.plan_id AND p.shared_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Until the plan is shared, delete the objective instead' USING ERRCODE = '22023';
  END IF;
  NEW.retired_at := now();
 ELSIF NEW.retired_at IS NOT NULL THEN
  RAISE EXCEPTION 'Only a removed season objective has a removal date' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER season_objectives_fixed_columns ON public.season_objectives;
CREATE TRIGGER season_objectives_fixed_columns BEFORE INSERT OR UPDATE ON public.season_objectives
  FOR EACH ROW EXECUTE FUNCTION trak_private.season_objective_fixed_columns();

-- What changes on a shared plan waits under "Not shared yet": a season objective added, reworded or removed, or a
-- player's objectives changed through save_player_objectives(). These run as Trak, which keeps the list.
CREATE FUNCTION trak_private.note_season_objective_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND NEW.title IS NOT DISTINCT FROM OLD.title AND NEW.looks_like IS NOT DISTINCT FROM OLD.looks_like
   AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
  RETURN NULL;
 END IF;
 UPDATE public.season_plans p SET unshared_parts = array_append(p.unshared_parts, 'season_objectives')
  WHERE p.id = NEW.plan_id AND p.shared_at IS NOT NULL AND NOT 'season_objectives' = ANY (p.unshared_parts);
 RETURN NULL;
END $$;
CREATE FUNCTION trak_private.note_player_objective_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.season_plans p SET unshared_players = array_append(p.unshared_players, NEW.squad_player_id)
  FROM public.squad_players sp
  WHERE sp.id = NEW.squad_player_id AND p.coach_user_id = sp.coach_user_id AND p.squad = btrim(sp.age_group)
    AND p.shared_at IS NOT NULL AND NOT NEW.squad_player_id = ANY (p.unshared_players);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION trak_private.note_season_objective_change(), trak_private.note_player_objective_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER season_objectives_note_change AFTER INSERT OR UPDATE ON public.season_objectives
  FOR EACH ROW EXECUTE FUNCTION trak_private.note_season_objective_change();
CREATE TRIGGER player_objectives_note_change AFTER INSERT OR UPDATE ON public.player_objectives
  FOR EACH ROW EXECUTE FUNCTION trak_private.note_player_objective_change();

-- Shares the plan: the first time from the set-up's last step, then each time the coach shares the changes. Returns
-- when. The same refusal for another coach's plan as for one that doesn't exist.
CREATE FUNCTION public.share_season_plan(p_plan_id uuid, p_talked boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_plan public.season_plans%ROWTYPE;
BEGIN
 -- Locks the plan, so two shares run one after the other.
 SELECT * INTO v_plan FROM public.season_plans p WHERE p.id = p_plan_id AND p.coach_user_id = (SELECT auth.uid()) FOR UPDATE;
 IF NOT FOUND OR NOT public.is_coach() OR NOT trak_private.coaches_squad(v_plan.squad) THEN
  RAISE EXCEPTION 'This season plan isn''t one of yours' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF v_plan.starts_on IS NULL OR v_plan.ends_on IS NULL THEN
  RAISE EXCEPTION 'Add the season''s dates first' USING ERRCODE = 'P0001';
 END IF;
 IF v_plan.shared_at IS NULL AND p_talked IS NOT TRUE AND (
     EXISTS (SELECT 1 FROM public.season_objectives so WHERE so.plan_id = v_plan.id AND so.status = 'open')
     OR EXISTS (SELECT 1 FROM public.player_objectives po JOIN public.squad_players sp ON sp.id = po.squad_player_id
       WHERE po.status = 'open' AND sp.coach_user_id = v_plan.coach_user_id AND btrim(sp.age_group) = v_plan.squad
         AND sp.status IS DISTINCT FROM 'coach_departed')) THEN
  RAISE EXCEPTION 'Talk the objectives through with the players, face to face, before you share them' USING ERRCODE = 'P0001';
 END IF;
 UPDATE public.season_plans p SET shared_at = coalesce(p.shared_at, now()), last_shared_at = now(),
   unshared_parts = '{}', unshared_players = '{}'
  WHERE p.id = v_plan.id;
 RETURN now();
END $$;
REVOKE ALL ON FUNCTION public.share_season_plan(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.share_season_plan(uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.share_season_plan(uuid, boolean) IS
  'TRAK-356: shares a season plan (the first time, or its changes). Checks the coach, the squad, the season_plan switch, the dates and, at the first share, the face-to-face talk.';

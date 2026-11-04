-- TRAK-350 (Season plan 2/18, spec TRAK-348): a squad's season plan, set up once. This slice holds the season's
-- dates and up to three season objectives (a title and what it looks like), saved as a draft only the squad's
-- coach sees. No player, guardian, other coach or academy admin reads it; what players and families see is
-- designed later (TRAK-366).
--
-- The season plan has its own academy switch. The operator runs one line either way:
--   on:  INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'season_plan');
--   off: DELETE FROM public.academy_features WHERE organization_id = '<academy id>' AND feature = 'season_plan';
-- No row means off. It goes on only where games is on, because Not attending lives in the match line-up
-- (TRAK-359). Writes need the switch; reads don't, so switching it off hides the plan without losing it.
--
-- A squad is the coach's roster rows with one age group (TRAK-176), so a plan belongs to its coach and names
-- that age group. One plan per squad for now. Nobody deletes a plan. Until the plan is first shared (TRAK-356
-- sets shared_at), deleting a season objective really deletes it.

ALTER TABLE public.academy_features
  DROP CONSTRAINT academy_features_feature_check,
  ADD CONSTRAINT academy_features_feature_check CHECK (feature IN ('events', 'games', 'training', 'season_plan'));

CREATE TABLE public.season_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  squad text NOT NULL CHECK (char_length(squad) BETWEEN 1 AND 40 AND squad = btrim(squad)),
  -- A draft may wait for its dates; once both are set the season ends after it starts.
  starts_on date,
  ends_on date,
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_plans_one_per_squad UNIQUE (coach_user_id, squad),
  CONSTRAINT season_plans_end_after_start CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on > starts_on)
);
CREATE TRIGGER season_plans_updated_at BEFORE UPDATE ON public.season_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Up to three: each takes one of three places, so a fourth has nowhere to go even when two saves race.
CREATE TABLE public.season_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.season_plans(id) ON DELETE CASCADE,
  place smallint NOT NULL CHECK (place BETWEEN 1 AND 3),
  -- The same limits as a match instruction (valid_game_goals), so one fits in a match plan (TRAK-363).
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  looks_like text NOT NULL DEFAULT '' CHECK (char_length(looks_like) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_objectives_one_per_place UNIQUE (plan_id, place)
);
CREATE INDEX season_objectives_plan_idx ON public.season_objectives(plan_id);
CREATE TRIGGER season_objectives_updated_at BEFORE UPDATE ON public.season_objectives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.season_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_objectives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.season_plans, public.season_objectives FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.season_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.season_objectives TO authenticated;

-- A coach writes a plan's squad once and its dates after, never its owner or when it was shared: Share (TRAK-356)
-- sets that through its own function, which this doesn't hold back. An objective keeps its plan and its place.
CREATE FUNCTION trak_private.season_plan_fixed_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.shared_at IS NOT NULL THEN RAISE EXCEPTION 'A season plan starts as a draft' USING ERRCODE = '42501'; END IF;
 ELSIF NEW.coach_user_id IS DISTINCT FROM OLD.coach_user_id OR NEW.squad IS DISTINCT FROM OLD.squad
   OR NEW.shared_at IS DISTINCT FROM OLD.shared_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'Only a season plan''s dates change' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION trak_private.season_objective_fixed_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('authenticated', 'anon')
   AND (NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.place IS DISTINCT FROM OLD.place) THEN
  RAISE EXCEPTION 'A season objective keeps its plan and its place' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trak_private.season_plan_fixed_columns(), trak_private.season_objective_fixed_columns() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER season_plans_fixed_columns BEFORE INSERT OR UPDATE ON public.season_plans
  FOR EACH ROW EXECUTE FUNCTION trak_private.season_plan_fixed_columns();
CREATE TRIGGER season_objectives_fixed_columns BEFORE UPDATE ON public.season_objectives
  FOR EACH ROW EXECUTE FUNCTION trak_private.season_objective_fixed_columns();

-- True when the caller coaches a squad with this age group that is still theirs.
CREATE FUNCTION trak_private.coaches_squad(p_squad text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.squad_players sp
    WHERE sp.coach_user_id = (SELECT auth.uid()) AND btrim(sp.age_group) = p_squad
      AND sp.status IS DISTINCT FROM 'coach_departed')
$$;
REVOKE ALL ON FUNCTION trak_private.coaches_squad(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.coaches_squad(text) TO authenticated, service_role;

CREATE POLICY "Coaches read their own season plans" ON public.season_plans
  FOR SELECT TO authenticated
  USING (coach_user_id = (SELECT auth.uid()));
CREATE POLICY "Coaches start a season plan for their own squad" ON public.season_plans
  FOR INSERT TO authenticated
  WITH CHECK (public.is_coach() AND coach_user_id = (SELECT auth.uid()) AND trak_private.coaches_squad(squad));
CREATE POLICY "Coaches change their own season plans" ON public.season_plans
  FOR UPDATE TO authenticated
  USING (coach_user_id = (SELECT auth.uid()))
  WITH CHECK (public.is_coach() AND coach_user_id = (SELECT auth.uid()) AND trak_private.coaches_squad(squad));

-- An objective's coach is its plan's coach.
CREATE POLICY "Coaches read their own season objectives" ON public.season_objectives
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.season_plans p WHERE p.id = season_objectives.plan_id AND p.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Coaches add their own season objectives" ON public.season_objectives
  FOR INSERT TO authenticated
  WITH CHECK (public.is_coach() AND EXISTS (SELECT 1 FROM public.season_plans p
    WHERE p.id = season_objectives.plan_id AND p.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Coaches change their own season objectives" ON public.season_objectives
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.season_plans p WHERE p.id = season_objectives.plan_id AND p.coach_user_id = (SELECT auth.uid())))
  WITH CHECK (public.is_coach() AND EXISTS (SELECT 1 FROM public.season_plans p
    WHERE p.id = season_objectives.plan_id AND p.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Coaches delete their own season objectives" ON public.season_objectives
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.season_plans p WHERE p.id = season_objectives.plan_id AND p.coach_user_id = (SELECT auth.uid())));

-- Restrictive, as the other switches are: no stray grant or permissive rule can open writes for an academy that
-- is off. A shared plan's objectives are never deleted (TRAK-356 retires them instead).
CREATE POLICY "Season plan switch gates plan inserts" ON public.season_plans
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('season_plan')));
CREATE POLICY "Season plan switch gates plan updates" ON public.season_plans
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('season_plan')))
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('season_plan')));
CREATE POLICY "Season plan switch gates objective inserts" ON public.season_objectives
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('season_plan')));
CREATE POLICY "Season plan switch gates objective updates" ON public.season_objectives
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('season_plan')))
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('season_plan')));
CREATE POLICY "Season plan switch and a draft gate objective deletes" ON public.season_objectives
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('season_plan')) AND EXISTS (SELECT 1 FROM public.season_plans p
    WHERE p.id = season_objectives.plan_id AND p.shared_at IS NULL));

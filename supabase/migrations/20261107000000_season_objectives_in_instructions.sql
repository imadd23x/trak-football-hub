-- TRAK-363 (Season plan 15/18, spec TRAK-348): a season objective picked in a match plan's Instructions. The pick
-- fills in the title and what it looks like, and carries the objective's id, so Home can measure each season objective
-- from "Did the plan work?" (Worked / Partly / Didn't), which stays tied to each instruction's place in the list. The
-- coach can still edit the words; the link stays. Typed instructions carry no id and don't count toward the season.
--
-- An instruction may carry `season_objective_id`, and only one from the coach's own plan for the match's squad. Old
-- plans without ids stay valid, and so do the players' copies (game_for_player), which keep what was shared.

-- Up to three instructions: a title, what it looks like, and optionally the season objective it carries.
CREATE OR REPLACE FUNCTION trak_private.valid_game_goals(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE goal jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(value) > 3 THEN RETURN false; END IF;
 FOR goal IN SELECT * FROM jsonb_array_elements(value) LOOP
  IF jsonb_typeof(goal) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(goal) k WHERE k NOT IN ('title', 'looks_like', 'season_objective_id')) THEN RETURN false; END IF;
  IF NOT COALESCE(jsonb_typeof(goal->'title') = 'string' AND char_length(goal->>'title') <= 80
    AND jsonb_typeof(goal->'looks_like') = 'string' AND char_length(goal->>'looks_like') <= 300, false) THEN RETURN false; END IF;
  IF goal ? 'season_objective_id' AND jsonb_typeof(goal->'season_objective_id') <> 'null' AND NOT COALESCE(
    jsonb_typeof(goal->'season_objective_id') = 'string'
    AND goal->>'season_objective_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

-- The objective comes from the match coach's plan for the match's squad. It may since have been removed (retired):
-- a plan that already carries it stays saveable, and its matches keep counting.
CREATE FUNCTION trak_private.game_plan_objectives_mine() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 -- Goals that aren't a list are the goals check's to refuse too.
 IF jsonb_typeof(NEW.goals) = 'array' AND EXISTS (
   SELECT 1 FROM jsonb_array_elements(NEW.goals) goal
   -- A malformed id is the goals check's to refuse.
   WHERE jsonb_typeof(goal->'season_objective_id') = 'string'
     AND goal->>'season_objective_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (
       SELECT 1 FROM public.season_objectives so
       JOIN public.season_plans p ON p.id = so.plan_id
       JOIN public.coach_calendar_events e ON e.id = NEW.event_id
       WHERE so.id = (goal->>'season_objective_id')::uuid
         AND p.coach_user_id = e.coach_user_id AND p.squad = btrim(e.squad))) THEN
  RAISE EXCEPTION 'An instruction''s season objective comes from your plan for this squad' USING ERRCODE = '22023';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trak_private.game_plan_objectives_mine() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER game_plans_objectives_mine BEFORE INSERT OR UPDATE OF goals ON public.game_plans
  FOR EACH ROW EXECUTE FUNCTION trak_private.game_plan_objectives_mine();

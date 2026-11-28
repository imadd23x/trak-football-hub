-- TRAK-632. Imad, 28 Nov: Tasks is part of Trak for every academy, like Season plan (option 1 in #coding-agents-at-work).
-- Until now 'tasks' was one academy_features row an operator added by hand (on 28 Nov: Trak Test Academy only), so
-- coaches of every other academy had no Send a task, and their players had no My tasks and no training plan (TRAK-601).
--
-- The trigger that gives a new academy its switches (20261121120000) now gives it tasks too, and every existing academy
-- is switched on once here. Deleting the row still turns tasks off for that academy with no deploy.

CREATE OR REPLACE FUNCTION public.new_academy_starts_with_events_on()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.academy_features(organization_id, feature)
  SELECT NEW.id, f FROM unnest(ARRAY['events', 'games', 'training', 'family_look', 'season_plan', 'tasks']) f
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

INSERT INTO public.academy_features(organization_id, feature)
SELECT o.id, 'tasks' FROM public.organizations o
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations o
    WHERE NOT EXISTS (SELECT 1 FROM public.academy_features a WHERE a.organization_id = o.id AND a.feature = 'tasks')) THEN
    RAISE EXCEPTION 'An academy is still without tasks after the switch-on';
  END IF;
END $$;

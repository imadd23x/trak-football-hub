-- TRAK-601 (coach–player P13): the squad's players read their training's plan (Makis, 25 Nov: "All players in the
-- Squad should be able to read the Training Plan"; Imad, 27 Nov: drills and set-up). Players still have no grant on the
-- plan tables: they read through my_training_plans(), which returns only what is meant for them. Never "Watch for"
-- (practice.tell, the coaching points), the coach's note, or where a practice came from. A plan reaches a player only
-- where the academy has the tasks switch on, on a published training that isn't cancelled, through child_events (the
-- player's squad, consent in place). A saved plan asks each squad for one Got it, asked again on every save.

-- ── The player's read ────────────────────────────────────────────────────────
-- session_id is the register taken for the training (coach_sessions.event_id, 20261011120000), the id the player's past
-- trainings already carry (family_training_history), so a past training links to its plan.
CREATE FUNCTION public.my_training_plans()
RETURNS TABLE (
  event_id uuid, event_date date, session_id uuid, "position" smallint, part text, name text, minutes smallint, how text,
  area text, numbers text, direction text, targets text, conditions text, trak_drill text, trak_level smallint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.event_id, ce.event_date, s.id, p.position, p.part, p.name, p.minutes, p.how, p.area, p.numbers, p.direction,
    p.targets, p.conditions, p.trak_drill, p.trak_level
  FROM public.child_events((SELECT auth.uid())) ce
  JOIN public.coach_calendar_events e ON e.id = ce.id
  JOIN public.training_plan_practices p ON p.event_id = ce.id
  LEFT JOIN public.coach_sessions s ON s.event_id = ce.id
  WHERE ce.event_type = 'training' AND ce.status <> 'cancelled'
    AND EXISTS (SELECT 1 FROM public.academy_features f WHERE f.organization_id = e.organization_id AND f.feature = 'tasks')
  ORDER BY ce.event_date, p.event_id, p.position;
$$;
REVOKE ALL ON FUNCTION public.my_training_plans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_training_plans() TO authenticated;

-- ── One Got it per squad ─────────────────────────────────────────────────────
-- Squads as P03's seen tasks (20261127090000): the coach's active squads, or the training's own. Open until it starts.
CREATE UNIQUE INDEX trak_tasks_training_plan_idx ON public.trak_tasks (source_id, squad) WHERE source_type = 'training_plan';

-- ponytail: every save asks again, even one that changed only what players never see (the note, Watch for); compare
-- the players' fields before and after if coaches re-save often.
CREATE FUNCTION trak_private.ask_players_to_read_plan(p_event_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
  INSERT INTO public.trak_tasks (organization_id, coach_user_id, squad, source_type, source_id, answer_kind, title, due_at)
  SELECT e.organization_id, e.coach_user_id, s.squad, 'training_plan', e.id, 'got_it',
    btrim(left('Training plan: ' || coalesce(nullif(btrim(e.title), ''), 'Training'), 80)), e.starts_at
  FROM public.coach_calendar_events e
  CROSS JOIN LATERAL (SELECT DISTINCT btrim(sp.age_group) AS squad FROM public.squad_players sp
    WHERE sp.coach_user_id = e.coach_user_id AND sp.organization_id = e.organization_id AND sp.status = 'active'
      AND btrim(sp.age_group) <> '' AND (e.squad IS NULL OR btrim(sp.age_group) = btrim(e.squad))) s
  WHERE e.id = p_event_id AND e.published AND e.event_type = 'training' AND e.status <> 'cancelled'
    AND e.organization_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.training_plans p WHERE p.event_id = e.id)
    AND EXISTS (SELECT 1 FROM public.academy_features f WHERE f.organization_id = e.organization_id AND f.feature = 'tasks')
  ON CONFLICT (source_id, squad) WHERE source_type = 'training_plan'
  DO UPDATE SET source_version = public.trak_tasks.source_version + 1, title = EXCLUDED.title, due_at = EXCLUDED.due_at,
    status = 'open';
$fn$;
REVOKE ALL ON FUNCTION trak_private.ask_players_to_read_plan(uuid) FROM PUBLIC, anon, authenticated;

-- Saving a plan (save_training_plan writes this row on every save).
CREATE FUNCTION trak_private.plan_saved_asks_players() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM trak_private.ask_players_to_read_plan(NEW.event_id);
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION trak_private.plan_saved_asks_players() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_plan_saved_asks_players AFTER INSERT OR UPDATE ON public.training_plans
  FOR EACH ROW EXECUTE FUNCTION trak_private.plan_saved_asks_players();

-- The training itself: publishing a planned training asks; cancelling closes the ask; a new start time moves its end.
CREATE FUNCTION trak_private.training_change_moves_plan_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.status = 'cancelled' THEN
    UPDATE public.trak_tasks SET status = 'closed' WHERE source_type = 'training_plan' AND source_id = NEW.id;
  ELSIF NEW.published AND NOT OLD.published THEN
    PERFORM trak_private.ask_players_to_read_plan(NEW.id);
  ELSIF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    UPDATE public.trak_tasks SET due_at = NEW.starts_at WHERE source_type = 'training_plan' AND source_id = NEW.id;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION trak_private.training_change_moves_plan_task() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_training_change_moves_plan_task AFTER UPDATE ON public.coach_calendar_events
  FOR EACH ROW WHEN (NEW.event_type = 'training' AND (OLD.published, OLD.status, OLD.starts_at)
    IS DISTINCT FROM (NEW.published, NEW.status, NEW.starts_at))
  EXECUTE FUNCTION trak_private.training_change_moves_plan_task();

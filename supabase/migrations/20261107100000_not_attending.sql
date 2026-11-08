-- TRAK-359 (Season plan 11/18, spec TRAK-348): Not attending, a third place beside Bench and Not selected in the match
-- line-up. The coach marks who isn't coming (everyone else is coming), and a family's "Can't make it" puts the child
-- there. Write access is unchanged: only the match's coach writes line-up rows (game_plan_players' policies).
--
-- Players and families read it as they read Not selected: "Not in the squad this week", never why. The copies Share
-- writes keep their two roles, so the shared plan and the apps that read it need no new value.

ALTER TABLE public.game_plan_players DROP CONSTRAINT game_plan_players_role_check;
ALTER TABLE public.game_plan_players
  ADD CONSTRAINT game_plan_players_role_check CHECK (role IN ('starter', 'bench', 'not_selected', 'not_attending')),
  -- Not attending carries nothing: no note either, as nobody reads one.
  ADD CONSTRAINT game_plan_players_not_attending_blank CHECK (
    role <> 'not_attending' OR (job = '' AND note = '' AND context = '{}' AND expectation = 'usual'));

-- A child whose family reported "Can't make it" stays in Not attending until the family undoes it. SECURITY DEFINER so
-- the check sees the report whatever the caller's rules let them read.
CREATE FUNCTION trak_private.keep_family_reported_not_attending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.role = 'not_attending' AND NEW.role <> 'not_attending'
     AND EXISTS (SELECT 1 FROM public.event_absences a
       WHERE a.event_id = OLD.event_id AND a.squad_player_id = OLD.squad_player_id) THEN
    RAISE EXCEPTION 'Their family said they can''t make it; it stays until the family undoes it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trak_private.keep_family_reported_not_attending() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER game_plan_players_keep_family_report BEFORE UPDATE OF role ON public.game_plan_players
  FOR EACH ROW EXECUTE FUNCTION trak_private.keep_family_reported_not_attending();

-- As 20261030200000_games_job_player_only.sql, with two changes: Not attending is copied as Not selected (the family's
-- and the child's copies hold the two roles they always did), and a Not attending child gets a copy even when their
-- family reported them, so they read "Not in the squad this week". A reported child the coach hasn't moved stays
-- uncopied, as before.
CREATE OR REPLACE FUNCTION trak_private.game_copies(p_event_id uuid)
RETURNS TABLE (squad_player_id uuid, copied boolean, role text, job text, note text, goals jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT sp.id,
    gp.role IN ('starter', 'not_attending')
      OR NOT EXISTS (SELECT 1 FROM public.event_absences a WHERE a.event_id = e.id AND a.squad_player_id = sp.id),
    CASE WHEN gp.role = 'not_attending' THEN 'not_selected' ELSE COALESCE(gp.role, 'bench') END,
    COALESCE(gp.job, ''), CASE WHEN gp.role = 'not_selected' THEN gp.note ELSE '' END,
    COALESCE(plan.goals, '[]'::jsonb)
  FROM public.coach_calendar_events e
  JOIN public.squad_players sp ON sp.coach_user_id = e.coach_user_id
  LEFT JOIN public.game_plans plan ON plan.event_id = e.id
  LEFT JOIN public.game_plan_players gp ON gp.event_id = e.id AND gp.squad_player_id = sp.id
  WHERE e.id = p_event_id
    AND e.coach_user_id = (SELECT auth.uid())
    AND public.squad_player_is_mine(sp.id)
    AND sp.organization_id IS NOT DISTINCT FROM e.organization_id
    AND sp.status <> 'coach_departed'
    AND (e.squad IS NULL OR sp.age_group = e.squad)
    AND NOT public.squad_player_consent_required(sp.id);
$$;

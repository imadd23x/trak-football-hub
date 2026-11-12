-- TRAK-401 (Season plan 18/18 build 6/8, spec TRAK-366): the progress on a published evaluation, for the player and,
-- in build 7 (TRAK-402), for a linked guardian. A player cannot read season_evaluations (only the coach can), so the
-- date an assessment closed and each objective's words at that evaluation come through this one read-only function.
--
-- Same rule as season_plan_for_player() (TRAK-396): the caller is the child or a guardian linked to the child, consent
-- is in place, the academy's season_plan switch is on, the plan is shared and the player has a shared objective still
-- standing (trak_private.readable_season_plans). Only an evaluation's published assessment of that child is answered,
-- and only the objectives the coach shared and has not removed. Anyone else gets no rows, and no error that says why.
--
-- What comes back is the progress and nothing else: no rating, no coach, and never the evaluation note. The note is
-- coach_shared_feedback, a table no guardian has ever had a policy on and this function does not touch; the player reads
-- it through that table's own policy. A test pins the exact keys.

-- One row per published evaluation assessment asked for. objectives: [{id, title, status, history}] for the objectives
-- with a status at this evaluation, in slot order; status is that evaluation's word (not_yet, some_progress, on_track,
-- met) and history is [{due_on, status}] up to and including this evaluation, oldest first.
CREATE FUNCTION public.evaluation_progress(p_assessments uuid[], p_child uuid DEFAULT NULL)
RETURNS TABLE (assessment_id uuid, due_on date, objectives jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, e.due_on,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', po.id, 'title', po.title, 'status', p.status,
        'history', (SELECT jsonb_agg(jsonb_build_object('due_on', e2.due_on, 'status', p2.status) ORDER BY e2.due_on)
          FROM public.objective_progress p2 JOIN public.season_evaluations e2 ON e2.id = p2.evaluation_id
          WHERE p2.player_objective_id = po.id AND e2.due_on <= e.due_on))
        ORDER BY po.slot, po.created_at)
      FROM public.objective_progress p
      JOIN public.player_objectives po ON po.id = p.player_objective_id
      WHERE p.evaluation_id = e.id AND po.squad_player_id = a.squad_player_id
        AND po.shared_at IS NOT NULL AND po.status <> 'retired'), '[]'::jsonb)
  FROM public.coach_assessments a
  JOIN public.season_evaluations e ON e.id = a.evaluation_id
  JOIN trak_private.readable_season_plans(p_child) r ON r.squad_player_id = a.squad_player_id AND r.plan_id = e.plan_id
  WHERE a.id = ANY (p_assessments) AND a.published_at IS NOT NULL
  ORDER BY e.due_on DESC, a.id;
$$;
REVOKE ALL ON FUNCTION public.evaluation_progress(uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluation_progress(uuid[], uuid) TO authenticated;
COMMENT ON FUNCTION public.evaluation_progress(uuid[], uuid) IS
  'TRAK-401: each objective''s progress at the published evaluations the caller may read (the child, or a linked guardian), with the evaluation''s date. Shared, not removed objectives only. Never the evaluation note.';

-- TRAK-441 slice 2.5b (Imad, 13 Nov): Season so far's Training tile ("21/24") for a player and their parent, on the
-- coach's own rules (src/lib/attendance-rate.ts, TRAK-182/197/211), so the two never disagree:
--   trainings only; the child's squad's or whole-roster ones; only those whose register was taken (someone present);
--   only on or after the day the child joined the roster (created_at before the end of that UTC day).
-- A family can read its own register ticks but not the coach's sessions, and the register writes "present" rows only,
-- so the total ("/24") can't be counted from the family's side. This gives the two counts and nothing else: no
-- dates, titles or notes. The child, or a linked parent, only; nothing while the child's consent is required (as the
-- family's read of session_attendance); nothing for a roster row whose coach left. No row when none counts.
CREATE FUNCTION public.child_training_attendance(p_child uuid)
RETURNS TABLE (attended integer, total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH me AS (
    SELECT sp.id, sp.coach_user_id, btrim(sp.age_group) AS squad, sp.created_at
    FROM public.squad_players sp
    WHERE sp.linked_player_id = p_child
      AND sp.status <> 'coach_departed'
      AND (p_child = (SELECT auth.uid()) OR EXISTS (
        SELECT 1 FROM public.player_parent_links l WHERE l.player_user_id = p_child AND l.parent_user_id = (SELECT auth.uid())))
      AND NOT public.player_consent_required(p_child)
  ), counted AS (
    SELECT me.id AS squad_player_id, s.id AS session_id
    FROM me
    JOIN public.coach_sessions s ON s.coach_user_id = me.coach_user_id
    WHERE s.session_type = 'training'
      AND s.session_date IS NOT NULL
      AND (s.squad IS NULL OR s.squad = me.squad)
      AND me.created_at < ((s.session_date + 1)::timestamp AT TIME ZONE 'UTC')
      AND EXISTS (SELECT 1 FROM public.session_attendance a WHERE a.session_id = s.id AND a.status = 'present')
  )
  SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.session_attendance a
           WHERE a.session_id = c.session_id AND a.squad_player_id = c.squad_player_id AND a.status = 'present'))::integer,
         count(*)::integer
  FROM counted c
  HAVING count(*) > 0;
$$;

REVOKE ALL ON FUNCTION public.child_training_attendance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.child_training_attendance(uuid) TO authenticated;

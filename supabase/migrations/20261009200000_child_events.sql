-- TRAK-131 (J8.8): one child's events, for the parent's child switcher.
-- J8.2's RLS answers "may this person read this event" across all of a
-- parent's children. A parent with two children in one squad, one of them
-- withdrawn, would then still see the squad's events with the withdrawn child
-- selected. This reads per child: that child's own consent, a current squad
-- row of the event's coach in the event's academy, published only. The caller
-- is the child or a linked guardian. Named columns, never the coach's notes.

CREATE FUNCTION public.child_events(p_child uuid)
RETURNS TABLE (
  id uuid,
  event_type text,
  title text,
  event_date date,
  start_time time,
  starts_at timestamptz,
  meet_time time,
  venue text,
  kit text,
  opponent text,
  home_away text,
  status text,
  cancel_reason text,
  sequence integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT e.id, e.event_type, e.title, e.event_date, e.start_time, e.starts_at,
         e.meet_time, e.venue, e.kit, e.opponent, e.home_away, e.status,
         e.cancel_reason, e.sequence
  FROM public.coach_calendar_events e
  WHERE e.published
    AND (p_child = auth.uid()
         OR EXISTS (SELECT 1 FROM public.player_parent_links l
                    WHERE l.player_user_id = p_child AND l.parent_user_id = auth.uid()))
    AND NOT public.player_consent_required(p_child)
    AND EXISTS (SELECT 1 FROM public.squad_players sp
                WHERE sp.linked_player_id = p_child
                  AND sp.coach_user_id = e.coach_user_id
                  AND sp.organization_id = e.organization_id
                  AND sp.status <> 'coach_departed');
$fn$;
REVOKE ALL ON FUNCTION public.child_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.child_events(uuid) TO authenticated;
COMMENT ON FUNCTION public.child_events(uuid) IS
  'TRAK-131 (J8.8). One child''s published squad events under that child''s consent, for the child or a linked guardian. Never notes.';

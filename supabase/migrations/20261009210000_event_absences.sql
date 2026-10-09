-- TRAK-137 (J8.14): "Can't make it", like a school register (Imad, 8 Oct).
-- Everyone counts as coming; a guardian reports the exceptions, with an
-- optional short reason, and can undo it until kickoff. J8.15's register
-- pre-fills from these rows: absent = a row for (event, squad row).
--
-- A report is a write about a child, so it needs that child's active consent
-- (G1), from one of their linked guardians (players don't answer in v1), on a
-- published, scheduled event of the child's current squad, with events
-- switched on for that academy (J8.1). Kickoff is the event's day and time in
-- Dubai; an event with no time yet can be changed until the end of its day.
-- The event's coach reads their events' absences; a guardian reads only their
-- own child's, and nothing after a withdrawal. Nobody writes the table
-- directly: the two functions below decide.

CREATE TABLE public.event_absences (
  event_id uuid NOT NULL REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE,
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 140),
  reported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, squad_player_id)
);
CREATE INDEX event_absences_squad_player ON public.event_absences (squad_player_id);
ALTER TABLE public.event_absences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_absences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_absences TO authenticated;

CREATE POLICY "Coaches read their events' absences" ON public.event_absences
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.coach_calendar_events e
                 WHERE e.id = event_id AND e.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Guardians read their child's absences" ON public.event_absences
  FOR SELECT TO authenticated
  USING (public.squad_player_is_my_child(squad_player_id));
-- After a withdrawal the guardian's view hides, like every family read
-- (20260927130000); the coach keeps the register's input.
CREATE POLICY "Family reads absences only with consent" ON public.event_absences
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT trak_private.family_read_blocked_for_squad_player(squad_player_id));

-- The squad row through which this guardian may report this child for this
-- event, after every check; raises a screen-readable 42501 otherwise.
CREATE FUNCTION trak_private.absence_target(p_event_id uuid, p_child uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_event public.coach_calendar_events;
  v_squad_player uuid;
  v_deadline timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.player_parent_links l
    WHERE l.player_user_id = p_child AND l.parent_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only a linked guardian can say a child can''t make it' USING ERRCODE = '42501';
  END IF;
  IF public.player_consent_required(p_child) THEN
    RAISE EXCEPTION 'Waiting for consent: nothing is recorded about this child until a guardian approves' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event FROM public.coach_calendar_events WHERE id = p_event_id;
  SELECT sp.id INTO v_squad_player FROM public.squad_players sp
  WHERE sp.linked_player_id = p_child
    AND sp.coach_user_id = v_event.coach_user_id
    AND sp.organization_id = v_event.organization_id
    AND sp.status <> 'coach_departed'
  LIMIT 1;
  IF NOT FOUND OR v_event.id IS NULL OR NOT v_event.published THEN
    RAISE EXCEPTION 'This event is not available for this child' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.academy_features f
                 WHERE f.organization_id = v_event.organization_id AND f.feature = 'events') THEN
    RAISE EXCEPTION 'Events are switched off for this academy' USING ERRCODE = '42501';
  END IF;
  IF v_event.status = 'cancelled' THEN
    RAISE EXCEPTION 'This event is cancelled' USING ERRCODE = '42501';
  END IF;

  v_deadline := CASE
    WHEN v_event.event_date IS NULL THEN v_event.starts_at
    WHEN v_event.start_time IS NULL THEN (v_event.event_date + 1)::timestamp AT TIME ZONE 'Asia/Dubai'
    ELSE (v_event.event_date + v_event.start_time) AT TIME ZONE 'Asia/Dubai'
  END;
  IF now() >= v_deadline THEN
    RAISE EXCEPTION 'This event has started; tell the coach directly' USING ERRCODE = '42501';
  END IF;
  RETURN v_squad_player;
END;
$fn$;
REVOKE ALL ON FUNCTION trak_private.absence_target(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.report_cant_make_it(p_event_id uuid, p_child uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_squad_player uuid := trak_private.absence_target(p_event_id, p_child);
BEGIN
  INSERT INTO public.event_absences (event_id, squad_player_id, reported_by, reason)
  VALUES (p_event_id, v_squad_player, auth.uid(), nullif(btrim(p_reason), ''))
  ON CONFLICT (event_id, squad_player_id) DO UPDATE
    SET reason = EXCLUDED.reason, reported_by = EXCLUDED.reported_by, reported_at = now();
END;
$fn$;

-- The checks run first, in DECLARE: inside the WHERE they would run only if a
-- row matched, so an undo after kickoff with nothing to undo would pass silently.
CREATE FUNCTION public.undo_cant_make_it(p_event_id uuid, p_child uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_squad_player uuid := trak_private.absence_target(p_event_id, p_child);
BEGIN
  DELETE FROM public.event_absences
  WHERE event_id = p_event_id AND squad_player_id = v_squad_player;
END;
$fn$;

REVOKE ALL ON FUNCTION public.report_cant_make_it(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_cant_make_it(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_cant_make_it(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_cant_make_it(uuid, uuid) TO authenticated;

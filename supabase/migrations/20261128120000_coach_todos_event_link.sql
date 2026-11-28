-- TRAK-621 (Other events → To-do 1/6, spec TRAK-620): a coach's own to-do can be linked to one of their own events.
-- Kostas, 27 Nov (with Makis's rule): nothing goes into the To-do by itself. On an "Other" event the coach taps
-- Add to To-do, says what to do and when, and it saves as one of their own to-dos (TRAK-612), linked to the event.
--
-- The link is optional: the to-dos added on Home stay as they are. A coach links only to an event they own. An event
-- has at most one open linked to-do (Add to To-do turns into "In To-do"). A draft event that is deleted takes its
-- to-do with it; a published event is cancelled, never deleted, so its to-do stays and Home says it was cancelled.
-- Who can read or write a to-do doesn't change: only its coach.

ALTER TABLE public.coach_todos
  ADD COLUMN calendar_event_id uuid REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE;

-- One open to-do per event; a ticked one doesn't count, so the coach can add it again.
CREATE UNIQUE INDEX coach_todos_one_open_per_event ON public.coach_todos (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL AND done_at IS NULL;

DROP POLICY "Coaches add their own to-dos" ON public.coach_todos;
CREATE POLICY "Coaches add their own to-dos" ON public.coach_todos
  FOR INSERT TO authenticated
  WITH CHECK (coach_user_id = (SELECT auth.uid()) AND public.is_coach()
    AND (calendar_event_id IS NULL OR EXISTS (SELECT 1 FROM public.coach_calendar_events e
      WHERE e.id = calendar_event_id AND e.coach_user_id = (SELECT auth.uid()))));

DROP POLICY "Coaches change their own to-dos" ON public.coach_todos;
CREATE POLICY "Coaches change their own to-dos" ON public.coach_todos
  FOR UPDATE TO authenticated
  USING (coach_user_id = (SELECT auth.uid()))
  WITH CHECK (coach_user_id = (SELECT auth.uid()) AND public.is_coach()
    AND (calendar_event_id IS NULL OR EXISTS (SELECT 1 FROM public.coach_calendar_events e
      WHERE e.id = calendar_event_id AND e.coach_user_id = (SELECT auth.uid()))));

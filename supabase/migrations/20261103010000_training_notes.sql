-- TRAK-339 (Training redo 1/5, spec TRAK-338, 2 Nov prototype): a training's Notes, the loop's last step after
-- Logistics → Plan → Who's here. Optional: the coach answers "Would you run this session again?" (Yes / Yes, with
-- changes / No) and may write a note for next time, or skips. Either way a row is kept, so the training leaves the
-- Next training card: `again` NULL with an empty note is a skip.
--
-- One row per training. Only the training's coach reads or writes it; no player, guardian, other coach or academy
-- admin. Writes also need the academy's training switch on and the coach's own training, not cancelled, as
-- restrictive rules, as plans' are. Reads don't need the switch, so switching Training off loses nothing. Notes go
-- with their training.

CREATE TABLE public.training_notes (
  event_id uuid PRIMARY KEY REFERENCES public.coach_calendar_events(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  again text CHECK (again IN ('yes', 'changes', 'no')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_notes_coach ON public.training_notes (coach_user_id, updated_at DESC);
CREATE TRIGGER training_notes_updated_at BEFORE UPDATE ON public.training_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.training_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.training_notes TO authenticated;

CREATE POLICY "Coaches read their own training notes" ON public.training_notes
  FOR SELECT TO authenticated
  USING (coach_user_id = (SELECT auth.uid()));
CREATE POLICY "Coaches write notes for their own trainings" ON public.training_notes
  FOR INSERT TO authenticated
  WITH CHECK (coach_user_id = (SELECT auth.uid()) AND public.is_coach() AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_notes.event_id AND e.coach_user_id = (SELECT auth.uid())));
CREATE POLICY "Coaches change their own training notes" ON public.training_notes
  FOR UPDATE TO authenticated
  USING (coach_user_id = (SELECT auth.uid()))
  WITH CHECK (coach_user_id = (SELECT auth.uid()) AND public.is_coach() AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_notes.event_id AND e.coach_user_id = (SELECT auth.uid())));

-- Restrictive: no stray grant or permissive rule can open writes for an academy that is off, or notes on a match or a
-- cancelled training.
CREATE POLICY "Training switch and an open training gate note inserts" ON public.training_notes
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('training')) AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_notes.event_id AND e.event_type = 'training' AND e.status <> 'cancelled'));
CREATE POLICY "Training switch and an open training gate note updates" ON public.training_notes
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('training')) AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_notes.event_id AND e.event_type = 'training' AND e.status <> 'cancelled'))
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('training')) AND EXISTS (SELECT 1 FROM public.coach_calendar_events e
    WHERE e.id = training_notes.event_id AND e.event_type = 'training' AND e.status <> 'cancelled'));

-- ============================================================
-- TRAK-75 [J4]: training_type holds only the fixed focus labels
--
-- Families may read a training's date, that it was training, and its focus
-- labels (TRAK-6, 25 Sep). They never read the coach's title or notes, which
-- can hold anything the coach typed. training_type is the column the family
-- projection will expose, so it must never hold free text. The app writes it
-- from the fixed "Session focus" choices (src/lib/training-focus.ts); this
-- makes the database refuse anything else, from any writer.
--
-- Format: the chosen keys, comma-separated, e.g. 'Technical,Set Pieces'.
-- Only on trainings. Production on 25 Sep: 4 trainings, all 'Tactical', and
-- no other session with a training_type, so the constraint validates as is.
-- ============================================================

ALTER TABLE public.coach_sessions
  ADD CONSTRAINT coach_sessions_training_type_vocabulary CHECK (
    training_type IS NULL OR (
      session_type = 'training'
      -- '' would split into an empty array, which <@ accepts.
      AND training_type <> ''
      AND string_to_array(training_type, ',') <@ ARRAY[
        'Technical', 'Tactical', 'Finishing', 'Set Pieces',
        'Physical', 'Possession', 'Goalkeeper', 'Game Based'
      ]::text[]
    )
  );

COMMENT ON COLUMN public.coach_sessions.training_type IS
  'TRAK-75: the training''s focus as fixed labels, comma-separated. Family-visible (J6), so never free text. Keep in step with src/lib/training-focus.ts.';

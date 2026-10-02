-- ============================================================
-- TRAK-15 (G4) / TRAK-63: a parent does not read the coach's message.
--
-- Decision, 25 Sep: parents see the bands, never the coach's message (TRAK-63,
-- #135). #135 stopped the app fetching it and kept this policy "on purpose,
-- reversible". Kostas accepted TRAK-63 on one condition: close the database
-- read before any real child is admitted. The coach screen now tells the coach
-- "Only {first} sees this"; while a linked parent could still read the row
-- through the API, that label was not true.
--
-- Measured on the deployed backend, 26 Sep 11:00 UTC, as
-- parent.andreas.papadakis: a direct REST read of coach_shared_feedback
-- returned both of the child's published messages, word for word.
--
-- What changes: one policy, 20260919150000's, as last reshaped by
-- 20260921110000 and 20260921182442.
-- What does not:
--   * the child still reads their own published message (consent-gated);
--   * the coach still reads and retracts their own;
--   * the parent still reads the child's assessment, i.e. the bands
--     (20260612000001), which is what the parent screens show;
--   * coach_assessment_notes stays coach-private, as it always was.
--
-- Reversing the decision after the pilot is one migration: recreate the
-- policy exactly as 20260921182442 left it.
-- ============================================================

DROP POLICY IF EXISTS "Parents read published feedback for their children"
  ON public.coach_shared_feedback;

-- Post-condition, by behaviour of the catalogue rather than by name: no
-- remaining read policy on the message table may route through a parent link.
-- A renamed copy of the dropped policy would pass a name check and fail this.
DO $migration$
DECLARE
  leaks text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO leaks
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'coach_shared_feedback'
    AND cmd IN ('SELECT', 'ALL')
    AND coalesce(qual, '') ~ 'player_parent_links';

  IF leaks IS NOT NULL THEN
    RAISE EXCEPTION 'TRAK-15: coach_shared_feedback is still readable through a parent link: %', leaks;
  END IF;
END;
$migration$;

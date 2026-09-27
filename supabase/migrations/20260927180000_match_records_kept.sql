-- TRAK-82 (J4): the coach's record of a child's match is not the child's to
-- erase. "Players can delete own matches" let a signed-in player delete any
-- match row about them; every match on production is coach-logged, and a
-- rehearsal child deleted one (reproduced 27 Sep, rolled back).
--
-- Player logging is cut (MVP Requirements; #123 closes player INSERT and
-- UPDATE), so no app role deletes matches. Both barriers, as A1c keeps for
-- assessments, notes and awards: no DELETE privilege, and a deny policy.
-- delete_my_account() (SECURITY DEFINER) still removes the caller's own
-- matches, and the operator (service_role) is unaffected.

DROP POLICY IF EXISTS "Players can delete own matches" ON public.matches;
REVOKE DELETE ON TABLE public.matches FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "No match deletion" ON public.matches;
CREATE POLICY "No match deletion" ON public.matches
  FOR DELETE TO authenticated USING (false);

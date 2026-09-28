-- ============================================================
-- TRAK-86 (J1): no app role deletes a squad row (Imad, 28 Sep).
--
-- A coach could still delete a squad row the roster doesn't hold (a legacy,
-- pre-roster child), and the delete cascades that child's assessments and
-- published messages (Tarek reproduced it on TRAK-82, rolled back). Rostered
-- rows were already refused by the TRAK-62 trigger, and since #164 coaches
-- can't create squad rows at all: the academy roster decides the squad.
--
-- Two barriers, as for matches (#179), assessments, notes and awards: no
-- DELETE grant for app roles, and a deny policy in place of the coach's
-- delete policy. The operator (service role) and delete_my_account()
-- (SECURITY DEFINER) keep their paths. The TRAK-62 trigger stays as it is.
-- ============================================================

DROP POLICY IF EXISTS "Coaches can delete own squad players" ON public.squad_players;
REVOKE DELETE ON TABLE public.squad_players FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "No squad deletion" ON public.squad_players;
CREATE POLICY "No squad deletion" ON public.squad_players
  FOR DELETE TO authenticated USING (false);

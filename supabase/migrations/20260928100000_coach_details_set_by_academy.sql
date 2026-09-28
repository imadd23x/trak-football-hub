-- ============================================================
-- TRAK-87 (G3): a coach's academy, age group, role and club are set by the
-- academy through Trak, never by the coach (Imad, 28 Sep).
--
-- Settings shows them read-only since #171, and staff are set up by Trak
-- since #151 (admit_staff_member, service role), so no app screen writes
-- coach_details any more. But "Coaches can update own details" still let a
-- coach change any column, and "Coaches can insert own details" let any
-- signed-in account create a coach_details row for itself. Only
-- organization_id was pinned (#151's trigger, which stays).
--
-- App roles lose INSERT and UPDATE on coach_details; the operator (service
-- role) and admit_staff_member (SECURITY DEFINER) keep theirs. Reads are
-- unchanged. The local /dev-setup helper's coach upsert stops working; it
-- was already refused for self-made staff since #151.
-- ============================================================

DROP POLICY IF EXISTS "Coaches can insert own details" ON public.coach_details;
DROP POLICY IF EXISTS "Coaches can update own details" ON public.coach_details;
REVOKE INSERT, UPDATE ON TABLE public.coach_details FROM PUBLIC, anon, authenticated;

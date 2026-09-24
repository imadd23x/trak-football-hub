-- TRAK-59 [G5]: close meeting_requests to app roles.
--
-- Meeting requests are not in the pilot (MVP Requirements), and the only
-- writer in the app, src/components/coach/CoachPlayerProfile.tsx, is imported
-- nowhere. The table's one policy (20260327034734) checked only
-- coach_user_id = auth.uid(): no roster ownership, academy or consent check,
-- so a signed-in coach could write a request about any child's roster row.
-- Closing a feature the pilot does not have is safer than guarding it; if it
-- returns, it returns with ownership and consent checks. Data stays;
-- service_role keeps access.

DROP POLICY IF EXISTS "Coaches can manage own meeting requests" ON public.meeting_requests;
REVOKE ALL ON TABLE public.meeting_requests FROM anon, authenticated;

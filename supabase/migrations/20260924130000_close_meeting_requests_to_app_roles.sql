-- TRAK-59 [G5]: close meeting_requests to app roles.
--
-- Meeting requests are not in the pilot (MVP Requirements), and the only
-- writer in the app, src/components/coach/CoachPlayerProfile.tsx, is imported
-- nowhere. Its coach policy checked only coach_user_id = auth.uid(): no roster
-- ownership, academy or consent check, so a signed-in coach could write a
-- request about any child's roster row. Its parent and player read policies
-- ignore consent too. Closing a feature the pilot does not have is safer than
-- guarding it; if it returns, it returns with ownership and consent checks.
-- All three policies go, so grants and policies still agree
-- (privilege_and_consent_security A1b). Data stays; service_role keeps access.

DROP POLICY IF EXISTS "Coaches can manage own meeting requests" ON public.meeting_requests;
DROP POLICY IF EXISTS "Parents can read child meeting requests" ON public.meeting_requests;
DROP POLICY IF EXISTS "Players can read own meeting requests" ON public.meeting_requests;
REVOKE ALL ON TABLE public.meeting_requests FROM anon, authenticated;

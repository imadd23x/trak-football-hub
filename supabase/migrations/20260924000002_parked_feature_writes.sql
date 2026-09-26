-- TRAK-47: schedule/recognition authoring and club coach removal are parked.
-- Keep historical SELECT policies, account export/deletion and trusted
-- maintenance. J4 sessions/match logging and J5 assessments/notes are shared
-- MVP capabilities and are deliberately outside this boundary.

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.coach_calendar_events, public.recognition_awards
  FROM PUBLIC, anon, authenticated;

-- Remove enabling policies so policy-derived grant convergence remains
-- read-only. Retain the existing SELECT and no-award-deletion policies.
DROP POLICY IF EXISTS "Coaches can insert events" ON public.coach_calendar_events;
DROP POLICY IF EXISTS "Coaches can update own events" ON public.coach_calendar_events;
DROP POLICY IF EXISTS "Coaches can delete own events" ON public.coach_calendar_events;
DROP POLICY IF EXISTS "Coaches can insert awards" ON public.recognition_awards;
DROP POLICY IF EXISTS "Coaches can update own awards" ON public.recognition_awards;

-- A later table grant or overlapping permissive policy must not silently
-- restore app authoring. These command-specific restrictions do not affect
-- SELECT and do not apply to the trusted service/operator roles.
DROP POLICY IF EXISTS "Parked calendar denies insert" ON public.coach_calendar_events;
CREATE POLICY "Parked calendar denies insert" ON public.coach_calendar_events
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "Parked calendar denies update" ON public.coach_calendar_events;
CREATE POLICY "Parked calendar denies update" ON public.coach_calendar_events
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Parked calendar denies delete" ON public.coach_calendar_events;
CREATE POLICY "Parked calendar denies delete" ON public.coach_calendar_events
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "Parked recognition denies insert" ON public.recognition_awards;
CREATE POLICY "Parked recognition denies insert" ON public.recognition_awards
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "Parked recognition denies update" ON public.recognition_awards;
CREATE POLICY "Parked recognition denies update" ON public.recognition_awards
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Parked recognition denies delete" ON public.recognition_awards;
CREATE POLICY "Parked recognition denies delete" ON public.recognition_awards
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- This SECURITY DEFINER RPC bypasses table RLS. Preserve its existing body:
-- trusted incident cleanup must still provide the owning club admin's auth.uid()
-- and pass the existing admin/organization checks. No client role can call it.
REVOKE EXECUTE ON FUNCTION public.remove_coach_from_org(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_coach_from_org(uuid) TO service_role;

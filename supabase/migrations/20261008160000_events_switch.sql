-- TRAK-124 (J8.1): events turn on or off per academy, with no deploy.
-- Events are proven on Rehearsal FC first and switched on for a real academy
-- only by a founder decision. The operator runs one line either way:
--   on:  INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'events');
--   off: DELETE FROM public.academy_features WHERE organization_id = '<academy id>' AND feature = 'events';
-- No row means off. App roles can neither read nor change switches.

CREATE TABLE public.academy_features (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- A misspelt name must fail loudly, not leave a feature silently off.
  feature text NOT NULL CHECK (feature IN ('events')),
  switched_on_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, feature)
);
ALTER TABLE public.academy_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.academy_features FROM PUBLIC, anon, authenticated;

-- True only when the caller is a coach whose academy has the feature on.
-- No academy, no coach, or no row: off. Used by the write rules below and by
-- the app (useFeature) to show or hide the "Coming soon" pill.
CREATE FUNCTION public.feature_on(p_feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.academy_features f
    WHERE f.organization_id = public.my_coach_organization_id()
      AND f.feature = p_feature
  );
$$;
REVOKE ALL ON FUNCTION public.feature_on(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_on(text) TO authenticated;

-- 20260924000002 parked the calendar by revoking writes and dropping the
-- coach's own-event policies. Both come back; the switch decides.
GRANT INSERT, UPDATE, DELETE ON TABLE public.coach_calendar_events TO authenticated;

DROP POLICY IF EXISTS "Coaches can insert events" ON public.coach_calendar_events;
CREATE POLICY "Coaches can insert events" ON public.coach_calendar_events
  FOR INSERT TO authenticated
  WITH CHECK (coach_user_id = auth.uid() AND public.is_coach());
DROP POLICY IF EXISTS "Coaches can update own events" ON public.coach_calendar_events;
CREATE POLICY "Coaches can update own events" ON public.coach_calendar_events
  FOR UPDATE TO authenticated
  USING (coach_user_id = auth.uid() AND public.is_coach())
  WITH CHECK (coach_user_id = auth.uid() AND public.is_coach());
DROP POLICY IF EXISTS "Coaches can delete own events" ON public.coach_calendar_events;
CREATE POLICY "Coaches can delete own events" ON public.coach_calendar_events
  FOR DELETE TO authenticated
  USING (coach_user_id = auth.uid() AND public.is_coach());

-- The switch is restrictive, like the parked barrier it replaces: no stray
-- grant or permissive policy can open writes for an academy that is off.
-- SELECT is untouched; the operator and service roles are unaffected.
DROP POLICY IF EXISTS "Parked calendar denies insert" ON public.coach_calendar_events;
DROP POLICY IF EXISTS "Parked calendar denies update" ON public.coach_calendar_events;
DROP POLICY IF EXISTS "Parked calendar denies delete" ON public.coach_calendar_events;
CREATE POLICY "Events switch gates insert" ON public.coach_calendar_events
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('events')));
CREATE POLICY "Events switch gates update" ON public.coach_calendar_events
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('events')))
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('events')));
CREATE POLICY "Events switch gates delete" ON public.coach_calendar_events
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('events')));

-- TRAK-47 follow-up (Imad, 26 Sep): the academy console is Coming soon for
-- the pilot (TRAK-43, #115), and a Coming-soon route's backend writes close.
-- staff_compliance holds the console's DBS records. It stayed writable by an
-- academy's own admin (organization_id = my_organization_id()): admin-only and
-- own academy, so no cross-academy exposure, but outside the pilot contract.
-- Same pattern as 20260924000002 for calendar and recognition. SELECT stays;
-- remove_coach_from_org (SECURITY DEFINER, service_role only) and the operator
-- are unaffected.

REVOKE INSERT, UPDATE, DELETE ON TABLE public.staff_compliance FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Admin can insert staff compliance" ON public.staff_compliance;
DROP POLICY IF EXISTS "Admin can update staff compliance" ON public.staff_compliance;
DROP POLICY IF EXISTS "Admin can delete staff compliance" ON public.staff_compliance;

-- A later grant or overlapping permissive policy must not silently restore
-- app writes.
DROP POLICY IF EXISTS "Parked compliance denies insert" ON public.staff_compliance;
CREATE POLICY "Parked compliance denies insert" ON public.staff_compliance
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "Parked compliance denies update" ON public.staff_compliance;
CREATE POLICY "Parked compliance denies update" ON public.staff_compliance
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Parked compliance denies delete" ON public.staff_compliance;
CREATE POLICY "Parked compliance denies delete" ON public.staff_compliance
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- TRAK-12 (G3): "no academy sees another academy's data." A coach reads their
-- academy's assessments (20260918163000), so academy membership decides who
-- sees a child's record. Until now an academy's join code was enough to get
-- in, through four doors (reproduced: g3_staff_admission, 13 of 18 failed):
--   1. a new account made itself a coach (with a code) or an academy admin,
--      through provision_my_profile, which is SECURITY DEFINER and so passes
--      20260526000005's policy;
--   2. an existing coach repeated signup with another academy's code;
--   3. join_organization moved any coach into the academy the code named;
--   4. a coach updated their own coach_details.organization_id directly.
-- For the pilot, staff are set up by Trak (Tarek, 26 Sep, option (a) on
-- TRAK-12). Two guards close every door without changing any function body
-- another PR is editing, and the operator gets one service-role call.
-- Existing staff profiles keep working; clearing an academy (a coach's
-- departure, remove_coach_from_org) is unaffected.
BEGIN;

-- ── Guard 1: no app caller creates a staff profile ────────────────────────
-- "App caller" is the request's database role: PostgREST sets authenticated
-- or anon per request, and that setting survives into SECURITY DEFINER
-- functions such as provision_my_profile (current_user becomes the owner, the
-- role setting does not). The operator runs as service_role or in the SQL
-- editor (role 'none'), and neither is refused.
CREATE OR REPLACE FUNCTION public.refuse_self_made_staff()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon')
     AND NEW.role::text IN ('coach', 'club')
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Staff accounts are set up by Trak. Ask your academy.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS profiles_refuse_self_made_staff ON public.profiles;
CREATE TRIGGER profiles_refuse_self_made_staff
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.refuse_self_made_staff();

-- ── Guard 2: no app caller puts a coach into an academy ───────────────────
-- Clearing is allowed (departure). Re-provisioning with the academy the coach
-- is already in is a no-op and allowed.
CREATE OR REPLACE FUNCTION public.refuse_self_chosen_academy()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon') AND NEW.organization_id IS NOT NULL AND (
       (TG_OP = 'INSERT' AND NOT EXISTS (
          SELECT 1 FROM public.coach_details cd
          WHERE cd.user_id = NEW.user_id AND cd.organization_id = NEW.organization_id))
    OR (TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id)
  ) THEN
    RAISE EXCEPTION 'Your academy is set by Trak. Ask your academy.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS coach_details_refuse_self_chosen_academy ON public.coach_details;
CREATE TRIGGER coach_details_refuse_self_chosen_academy
  BEFORE INSERT OR UPDATE OF organization_id ON public.coach_details
  FOR EACH ROW EXECUTE FUNCTION public.refuse_self_chosen_academy();

REVOKE ALL ON FUNCTION public.refuse_self_made_staff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refuse_self_chosen_academy() FROM PUBLIC, anon, authenticated;

-- join_organization existed only to join by code. Guard 2 already refuses it;
-- app roles lose EXECUTE too, so the code-join path is closed at the door.
-- get_org_id_by_join_code was its lookup; no screen or function calls it.
REVOKE ALL ON FUNCTION public.join_organization(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_org_id_by_join_code(text) FROM PUBLIC, anon, authenticated;

-- ── The operator's call ────────────────────────────────────────────────────
-- Creates or completes a staff profile for an existing auth account (made
-- first with an Auth invitation). A coach is placed in an existing academy; an
-- academy admin gets an academy, created here if they have none. Returns the
-- academy id. service_role only; the staff member's first sign-in then finds
-- their profile and provision_my_profile treats it as existing.
CREATE OR REPLACE FUNCTION public.admit_staff_member(
  p_user_id         uuid,
  p_role            text,
  p_full_name       text,
  p_organization_id uuid DEFAULT NULL,
  p_academy_name    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Only Trak sets up staff' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('coach', 'club') THEN
    RAISE EXCEPTION 'A staff role is coach or club' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'No account with that id' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id AND p.role::text <> p_role) THEN
    RAISE EXCEPTION 'That account already has a different role' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (user_id, role, full_name)
  VALUES (p_user_id, p_role::public.user_role, btrim(p_full_name))
  ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name;

  IF p_role = 'coach' THEN
    IF p_organization_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id) THEN
      RAISE EXCEPTION 'A coach needs an existing academy' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.coach_details (user_id, organization_id)
    VALUES (p_user_id, p_organization_id)
    ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id;
    UPDATE public.profiles SET invite_code = public.generate_unique_code('profile')
    WHERE user_id = p_user_id AND invite_code IS NULL;
    RETURN p_organization_id;
  END IF;

  SELECT o.id INTO v_org FROM public.organizations o WHERE o.admin_user_id = p_user_id;
  IF v_org IS NULL THEN
    IF btrim(COALESCE(p_academy_name, '')) = '' THEN
      RAISE EXCEPTION 'Academy name is required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.organizations (admin_user_id, name, join_code)
    VALUES (p_user_id, btrim(p_academy_name), public.generate_unique_code('org'))
    RETURNING id INTO v_org;
  END IF;
  RETURN v_org;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admit_staff_member(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_staff_member(uuid, text, text, uuid, text) TO service_role;

COMMIT;

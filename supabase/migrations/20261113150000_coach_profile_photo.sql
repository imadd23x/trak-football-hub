-- TRAK-460 (Imad, 11 Nov): a coach can have a profile picture again. G7 (20260923110906) closed every avatar read,
-- insert and update for every app role, and refused any avatar_url change. A child's photo is personal data about a
-- child and stays closed (it needs its own decision with the legal pack), so the exception is the coach, and only
-- the coach's own object:
--   * the avatars bucket allows an app role to read, add or replace ONE object, the one named by its own user id,
--     and only while its profile role is 'coach'. Anon, another coach, a player, a guardian and a club admin get
--     nothing, their own object included. (The permissive own-object policies already exist; these RESTRICTIVE ones
--     are ANDed with them, so a future broad policy cannot widen this.)
--   * profiles.avatar_url may be set only by a coach, and only to their own user id (the object key). A coach
--     can clear it. A player's or guardian's attempt still raises PILOT_FEATURE_DISABLED.
-- Deleting your own object stays open (20260922143046); it needs the SELECT above, which is why a non-coach cannot
-- use it to probe. A role cannot be changed by the user (the profile update policy pins it), so the role test below
-- is not a claim the caller controls.
DROP POLICY IF EXISTS "Pilot disables avatar reads" ON storage.objects;
DROP POLICY IF EXISTS "Pilot disables avatar uploads" ON storage.objects;
DROP POLICY IF EXISTS "Pilot disables avatar changes" ON storage.objects;
DROP POLICY IF EXISTS "Only a coach reads their own photo" ON storage.objects;
DROP POLICY IF EXISTS "Only a coach adds their own photo" ON storage.objects;
DROP POLICY IF EXISTS "Only a coach replaces their own photo" ON storage.objects;
DROP POLICY IF EXISTS "Signed-out callers get no photo" ON storage.objects;
DROP POLICY IF EXISTS "Signed-out callers add no photo" ON storage.objects;
DROP POLICY IF EXISTS "Signed-out callers replace no photo" ON storage.objects;

-- Signed out: nothing, as under G7. Kept apart from the coach rule below because anon has no privilege on
-- public.profiles, and a policy that names that table would fail for it ("permission denied") instead of denying.
CREATE POLICY "Signed-out callers get no photo" ON storage.objects
  AS RESTRICTIVE FOR SELECT TO anon USING (bucket_id <> 'avatars');
CREATE POLICY "Signed-out callers add no photo" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO anon WITH CHECK (bucket_id <> 'avatars');
CREATE POLICY "Signed-out callers replace no photo" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO anon USING (bucket_id <> 'avatars') WITH CHECK (bucket_id <> 'avatars');

CREATE POLICY "Only a coach reads their own photo" ON storage.objects
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket_id <> 'avatars'
    OR (name = auth.uid()::text
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'coach'))
  );

CREATE POLICY "Only a coach adds their own photo" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id <> 'avatars'
    OR (name = auth.uid()::text
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'coach'))
  );

CREATE POLICY "Only a coach replaces their own photo" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    bucket_id <> 'avatars'
    OR (name = auth.uid()::text
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'coach'))
  )
  WITH CHECK (
    bucket_id <> 'avatars'
    OR (name = auth.uid()::text
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.role = 'coach'))
  );

CREATE OR REPLACE FUNCTION public.guard_pilot_avatar_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  -- Same caller test as G7: current_setting('role') keeps the SET ROLE identity inside a SECURITY DEFINER RPC, and
  -- current_user covers a direct role connection. Neither trusts a JWT metadata claim. A coach may set the photo
  -- to their own user id (the object key) and may clear it; nothing else, for anyone.
  IF (current_user IN ('anon', 'authenticated')
      OR current_setting('role', true) IN ('anon', 'authenticated'))
     AND NEW.avatar_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url)
     AND NOT (NEW.role = 'coach' AND NEW.avatar_url = NEW.user_id::text) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PILOT_FEATURE_DISABLED: profile photos are for coaches only';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_pilot_avatar_write() FROM PUBLIC, anon, authenticated;

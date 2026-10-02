-- TRAK-60 [J1]: a profile is created only through provision_my_profile.
--
-- "Users can insert own profile" (user_id = auth.uid() AND role <> 'club') let
-- any signed-in account create its own player or parent profile straight
-- through the API, so any check signup makes (admission, TRAK-48) could be
-- skipped. The app never inserts profiles directly: AuthContext and
-- parent-invites.ts call provision_my_profile, which is SECURITY DEFINER and
-- unaffected. Updating one's own profile is unchanged; its policy already
-- keeps the role fixed.

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
REVOKE INSERT ON TABLE public.profiles FROM anon, authenticated;

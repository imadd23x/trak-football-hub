-- TRAK-104 (J3): a guardian's password reset signs the child out of every
-- device. reset-child-password (TRAK-84, #206) calls Auth's admin password
-- update, which leaves the child's existing sessions alive: a lost or shared
-- phone kept showing the child's assessments and history.
--
-- 1. end_child_login_sessions(user): deletes that user's auth.sessions rows
--    (refresh tokens go with them), so no device can renew its session. Only
--    for a guardian-created child login (child_logins.auth_user_id): the server
--    key can't use it to sign out a guardian or an ordinary player. Called by
--    reset-child-password right after the password update.
-- 2. my_session_is_live(): whether the caller's JWT session_id still has its
--    auth.sessions row (Supabase's documented check for a signed-out session).
--    The player app asks every 30 s and signs out when the answer is false, so
--    an open app is signed out within 30 s. A token with no session_id gets
--    NULL ("unknown"), never false.
--
-- Stated bound: an open app within 30 s; a copied access token can still call
-- the API until it expires, at most 3,600 s on this project (measured 2 Oct).
CREATE FUNCTION public.end_child_login_sessions(p_auth_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_count integer;
BEGIN
  IF p_auth_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.child_logins cl WHERE cl.auth_user_id = p_auth_user_id
  ) THEN
    RAISE EXCEPTION 'Only a guardian-created child login can be signed out here' USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_auth_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

CREATE FUNCTION public.my_session_is_live()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN auth.uid() IS NULL OR nullif(auth.jwt()->>'session_id', '') IS NULL THEN NULL
    ELSE EXISTS (SELECT 1 FROM auth.sessions s
                 WHERE s.id = (auth.jwt()->>'session_id')::uuid AND s.user_id = auth.uid())
  END;
$fn$;

REVOKE ALL ON FUNCTION public.end_child_login_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_child_login_sessions(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.my_session_is_live() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_session_is_live() TO authenticated;
COMMENT ON FUNCTION public.end_child_login_sessions(uuid) IS
  'TRAK-104: end every session of a guardian-created child login after a password reset. Server key only.';
COMMENT ON FUNCTION public.my_session_is_live() IS
  'TRAK-104: is the caller''s JWT session still in auth.sessions? NULL when the token has no session_id.';

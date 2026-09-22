CREATE SCHEMA IF NOT EXISTS trak_storage;
REVOKE ALL ON SCHEMA trak_storage FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA trak_storage TO authenticated;

-- Storage writes and account deletion share an Auth-row lock. A valid old JWT
-- alone is insufficient: the account must still exist when the write executes.
CREATE OR REPLACE FUNCTION trak_storage.can_write_own_avatar(p_name text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR p_name IS DISTINCT FROM actor::text THEN RETURN false; END IF;
  PERFORM 1 FROM auth.users WHERE id=actor FOR KEY SHARE;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION trak_storage.can_write_own_avatar(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION trak_storage.can_write_own_avatar(text) TO authenticated;

-- Restrictive policies compose with the separately reviewed audience/owner
-- policies; no existing permissive policy can bypass this live-account check.
DROP POLICY IF EXISTS "Avatar uploads require a live account" ON storage.objects;
CREATE POLICY "Avatar uploads require a live account" ON storage.objects AS RESTRICTIVE
 FOR INSERT TO authenticated
 WITH CHECK (bucket_id <> 'avatars' OR trak_storage.can_write_own_avatar(name));
DROP POLICY IF EXISTS "Avatar updates require a live account" ON storage.objects;
CREATE POLICY "Avatar updates require a live account" ON storage.objects AS RESTRICTIVE
 FOR UPDATE TO authenticated
 USING (bucket_id <> 'avatars' OR trak_storage.can_write_own_avatar(name))
 WITH CHECK (bucket_id <> 'avatars' OR trak_storage.can_write_own_avatar(name));

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Serializes with Storage INSERT/UPDATE policies before inspecting objects.
  PERFORM 1 FROM auth.users WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account no longer exists' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='avatars'
    AND (name=v_uid::text OR name LIKE v_uid::text || '/%')) THEN
    RAISE EXCEPTION 'Remove your avatar before deleting your account' USING ERRCODE='55000';
  END IF;

  SELECT role::text, full_name INTO v_role, v_name
  FROM public.profiles WHERE user_id = v_uid;

  -- ── Coach: anonymise rather than destroy ──────────────────
  -- A coach leaving must not erase the assessment history of the
  -- children they coached; the name is snapshotted first.
  IF v_role = 'coach' THEN
    UPDATE public.coach_assessments
      SET coach_name_snapshot = COALESCE(coach_name_snapshot, v_name)
      WHERE coach_user_id = v_uid;
    UPDATE public.recognition_awards
      SET coach_name_snapshot = COALESCE(coach_name_snapshot, v_name)
      WHERE coach_user_id = v_uid;

    DELETE FROM public.coach_assessment_notes WHERE coach_user_id = v_uid;

    UPDATE public.squad_players SET status = 'coach_departed'
      WHERE coach_user_id = v_uid AND status = 'active';

    UPDATE public.coach_assessments SET coach_user_id = NULL WHERE coach_user_id = v_uid;
    UPDATE public.recognition_awards SET coach_user_id = NULL WHERE coach_user_id = v_uid;
    UPDATE public.coach_sessions    SET coach_user_id = NULL WHERE coach_user_id = v_uid;
    UPDATE public.squad_players     SET coach_user_id = NULL WHERE coach_user_id = v_uid;

    DELETE FROM public.coach_details    WHERE user_id = v_uid;
    DELETE FROM public.staff_compliance WHERE coach_user_id = v_uid;
  END IF;

  -- ── Club admin ────────────────────────────────────────────
  IF v_role = 'club' THEN
    DELETE FROM public.admin_notes   WHERE admin_user_id = v_uid;
    DELETE FROM public.organizations WHERE admin_user_id = v_uid;
  END IF;

  -- ── Player ────────────────────────────────────────────────
  DELETE FROM public.matches        WHERE user_id = v_uid;
  DELETE FROM public.player_details WHERE user_id = v_uid;
  -- player_goals intentionally absent: the table no longer exists.
  DELETE FROM public.squad_players  WHERE linked_player_id = v_uid;

  -- ── Parent links ──────────────────────────────────────────
  DELETE FROM public.player_parent_links
    WHERE player_user_id = v_uid OR parent_user_id = v_uid;
  DELETE FROM public.parent_invites WHERE player_user_id = v_uid;

  -- ── Profile and auth user ─────────────────────────────────
  -- telemetry_events needs no statement: its user_id carries
  -- ON DELETE CASCADE against auth.users.
  DELETE FROM public.profiles WHERE user_id = v_uid;
  DELETE FROM auth.users      WHERE id = v_uid;
END;
$$;

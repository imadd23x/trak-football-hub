-- P1: invitation possession/email input must never authorize a guardian link.
-- Only the verified recipient, with a parent profile, may claim a player.
-- Existing links are preserved for a separate historical-access audit.

BEGIN;

ALTER TABLE public.parent_invites ADD COLUMN IF NOT EXISTS expires_at timestamptz;
-- Do not renew stale invitations when deploying this migration. Unknown creation
-- times fail closed; accepted rows retain their status and existing links.
UPDATE public.parent_invites
SET expires_at = COALESCE(created_at + interval '7 days', now())
WHERE expires_at IS NULL;
ALTER TABLE public.parent_invites
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days'),
  ALTER COLUMN expires_at SET NOT NULL;

-- Match the verified-email lookup expression, including historical whitespace.
-- The older lower(parent_email) index cannot constrain lower(trim(parent_email)).
CREATE INDEX IF NOT EXISTS idx_parent_invites_recipient_pending
  ON public.parent_invites (lower(trim(parent_email)), expires_at)
  WHERE status = 'pending';

-- Both creator and recipient writes must go through checked RPCs. Revoking
-- table privileges alone would leave any explicit column grants intact.
DO $migration$
DECLARE v_policy record; v_column record;
BEGIN
  FOR v_policy IN
    SELECT c.relname, p.polname
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('parent_invites', 'player_parent_links')
      AND p.polcmd <> 'r'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.polname, v_policy.relname);
  END LOOP;
  FOR v_column IN
    SELECT c.relname, a.attname
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('parent_invites', 'player_parent_links')
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  LOOP
    EXECUTE format(
      'REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM PUBLIC, anon, authenticated',
      v_column.attname, v_column.attname, v_column.attname, v_column.relname
    );
  END LOOP;
END;
$migration$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.parent_invites, public.player_parent_links FROM PUBLIC, anon, authenticated;
ALTER TABLE public.parent_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_parent_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.accept_parent_invite(p_invite_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_invite public.parent_invites%ROWTYPE;
BEGIN
  SELECT lower(trim(u.email)) INTO v_email
  FROM auth.users u
  JOIN public.profiles p ON p.user_id = u.id AND p.role = 'parent'
  WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'A verified parent account is required' USING ERRCODE = '42501';
  END IF;

  SELECT pi.* INTO v_invite FROM public.parent_invites pi
  WHERE pi.id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR lower(trim(v_invite.parent_email)) IS DISTINCT FROM v_email
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = v_invite.player_user_id AND p.role = 'player'
    ) THEN
    RAISE EXCEPTION 'Invitation is unavailable or expired' USING ERRCODE = '42501';
  END IF;

  -- Retries after a successful claim remain successful, including after expiry.
  -- An accepted invite must never be reassigned to a different account that
  -- later acquires the same email address.
  IF v_invite.status = 'accepted' AND EXISTS (
    SELECT 1 FROM public.player_parent_links l
    WHERE l.player_user_id = v_invite.player_user_id AND l.parent_user_id = v_uid
  ) THEN
    RETURN v_invite.player_user_id;
  END IF;
  IF v_invite.status <> 'pending' OR v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation is unavailable or expired' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
  VALUES (v_invite.player_user_id, v_uid)
  ON CONFLICT (player_user_id, parent_user_id) DO NOTHING;
  UPDATE public.parent_invites SET status = 'accepted' WHERE id = v_invite.id;
  RETURN v_invite.player_user_id;
END;
$fn$;

-- Retain the legacy signature used by provisioning and older clients. Email
-- is only a consistency check; authority comes from auth.users and the role.
CREATE OR REPLACE FUNCTION public.link_parent_to_players_by_email(p_email text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_invite record;
  v_inserted integer;
  v_count integer := 0;
BEGIN
  SELECT lower(trim(u.email)) INTO v_email
  FROM auth.users u
  JOIN public.profiles p ON p.user_id = u.id AND p.role = 'parent'
  WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR v_email = ''
    OR lower(trim(COALESCE(p_email, ''))) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'A matching verified parent account is required' USING ERRCODE = '42501';
  END IF;

  -- Lock in a deterministic order; duplicate historical invites cannot create
  -- duplicate links and concurrent claims cannot consume the same row twice.
  FOR v_invite IN
    SELECT pi.id, pi.player_user_id FROM public.parent_invites pi
    WHERE lower(trim(pi.parent_email)) = v_email
      AND pi.status = 'pending' AND pi.expires_at > now()
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = pi.player_user_id AND p.role = 'player')
    ORDER BY pi.id FOR UPDATE OF pi
  LOOP
    INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
    VALUES (v_invite.player_user_id, v_uid)
    ON CONFLICT (player_user_id, parent_user_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_count := v_count + v_inserted;
    UPDATE public.parent_invites SET status = 'accepted' WHERE id = v_invite.id;
  END LOOP;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.create_parent_invite(p_email text)
RETURNS TABLE(id uuid, parent_email text, invite_token uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(COALESCE(p_email, '')));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A verified player account is required' USING ERRCODE = '42501';
  END IF;
  -- Serialize invitation creation for this player, including concurrent signup
  -- retries, without deleting or consolidating historical invitation rows.
  PERFORM 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.role = 'player' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A verified player account is required' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A valid email address is required' USING ERRCODE = '22023';
  END IF;

  -- Creation stays idempotent. Expired invites require the explicit resend RPC
  -- so merely re-rendering or retrying creation cannot rotate a delivered link.
  RETURN QUERY
    SELECT pi.id, pi.parent_email, pi.invite_token, pi.status
    FROM public.parent_invites pi
    WHERE pi.player_user_id = v_uid AND lower(trim(pi.parent_email)) = v_email
    ORDER BY (pi.status = 'accepted') DESC, pi.created_at DESC NULLS LAST, pi.id
    LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    INSERT INTO public.parent_invites AS pi
      (player_user_id, parent_email, invite_token, status, created_at, expires_at)
    VALUES (v_uid, v_email, gen_random_uuid(), 'pending', now(), now() + interval '7 days')
    RETURNING pi.id, pi.parent_email, pi.invite_token, pi.status;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.resend_parent_invite(p_invite_id uuid)
RETURNS TABLE(id uuid, parent_email text, invite_token uuid, status text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_invite public.parent_invites%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A verified player account is required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.role = 'player' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A verified player account is required' USING ERRCODE = '42501';
  END IF;
  SELECT pi.* INTO v_invite FROM public.parent_invites pi
  WHERE pi.id = p_invite_id AND pi.player_user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_invite.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'Invitation is unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_invite.status = 'pending' THEN
    UPDATE public.parent_invites pi
    SET invite_token = gen_random_uuid(), expires_at = now() + interval '7 days'
    WHERE pi.id = v_invite.id;
  END IF;
  RETURN QUERY SELECT pi.id, pi.parent_email, pi.invite_token, pi.status, pi.expires_at
  FROM public.parent_invites pi WHERE pi.id = v_invite.id;
END;
$fn$;

DROP FUNCTION IF EXISTS public.get_player_invites_for_current_user();
CREATE FUNCTION public.get_player_invites_for_current_user()
RETURNS TABLE(id uuid, player_user_id uuid, parent_email text, invite_token uuid,
              status text, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT pi.id, pi.player_user_id, pi.parent_email, pi.invite_token,
         pi.status, pi.created_at, pi.expires_at
  FROM public.parent_invites pi
  JOIN auth.users u ON u.id = pi.player_user_id AND u.email_confirmed_at IS NOT NULL
  JOIN public.profiles p ON p.user_id = u.id AND p.role = 'player'
  WHERE u.id = auth.uid()
  ORDER BY pi.created_at DESC NULLS LAST, pi.id;
$fn$;

-- A copied token is a locator, never evidence of guardian identity. Signed-out
-- users authenticate first; tokenless discovery supports Supabase magic links
-- whose redirects do not include the original invite token.
CREATE OR REPLACE FUNCTION public.get_parent_invite_by_token(p_token uuid)
RETURNS TABLE(id uuid, player_user_id uuid, parent_email text, invite_token uuid,
              status text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT pi.id, pi.player_user_id, pi.parent_email, pi.invite_token, pi.status, pi.created_at
  FROM public.parent_invites pi
  JOIN public.profiles child ON child.user_id = pi.player_user_id AND child.role = 'player'
  JOIN auth.users u ON u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
  LEFT JOIN public.profiles caller ON caller.user_id = u.id
  WHERE pi.invite_token = p_token AND pi.status = 'pending' AND pi.expires_at > now()
    AND (
      (lower(trim(pi.parent_email)) = lower(trim(u.email)) AND (caller.user_id IS NULL OR caller.role = 'parent'))
      OR (pi.player_user_id = u.id AND caller.role = 'player')
    );
$fn$;

CREATE OR REPLACE FUNCTION public.get_my_pending_parent_invites()
RETURNS TABLE(invite_id uuid, player_user_id uuid, player_name text, parent_email text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT pi.id, pi.player_user_id, child.full_name, pi.parent_email, pi.expires_at
  FROM public.parent_invites pi
  JOIN public.profiles child ON child.user_id = pi.player_user_id AND child.role = 'player'
  JOIN auth.users u ON u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    AND lower(trim(u.email)) = lower(trim(pi.parent_email))
  LEFT JOIN public.profiles caller ON caller.user_id = u.id
  WHERE pi.status = 'pending' AND pi.expires_at > now()
    AND (caller.user_id IS NULL OR caller.role = 'parent')
  ORDER BY pi.created_at DESC NULLS LAST, pi.id;
$fn$;

CREATE OR REPLACE FUNCTION public.get_my_pending_parent_invite()
RETURNS TABLE(invite_id uuid, player_user_id uuid, player_name text, parent_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT pi.invite_id, pi.player_user_id, pi.player_name, pi.parent_email
  FROM public.get_my_pending_parent_invites() pi LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.get_parent_pending_invites_for_current_user()
RETURNS TABLE(id uuid, player_user_id uuid, parent_email text, status text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT pi.id, pi.player_user_id, pi.parent_email, pi.status, pi.created_at
  FROM public.parent_invites pi
  JOIN public.profiles child ON child.user_id = pi.player_user_id AND child.role = 'player'
  JOIN auth.users u ON u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    AND lower(trim(u.email)) = lower(trim(pi.parent_email))
  LEFT JOIN public.profiles caller ON caller.user_id = u.id
  WHERE pi.status = 'pending' AND pi.expires_at > now()
    AND (caller.user_id IS NULL OR caller.role = 'parent')
  ORDER BY pi.created_at DESC NULLS LAST, pi.id;
$fn$;

-- Remove explicit anon grants as well as PostgreSQL's inherited PUBLIC grant.
REVOKE ALL ON FUNCTION public.accept_parent_invite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_parent_to_players_by_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_parent_invite(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resend_parent_invite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_player_invites_for_current_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_parent_invite_by_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_pending_parent_invites() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_pending_parent_invite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_parent_pending_invites_for_current_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_parent_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_parent_to_players_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_parent_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_parent_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_invites_for_current_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_invite_by_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_parent_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_parent_invite() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_pending_invites_for_current_user() TO authenticated;

-- Provisioning definition follows below so creation uses the same checked RPC.
CREATE OR REPLACE FUNCTION public.provision_my_profile(p jsonb)
RETURNS jsonb  -- { "warnings": ["..."] }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_email         text;
  v_role          text := p->>'role';
  v_existing_role text;
  v_org           uuid;
  v_academy_code  text;
  v_coach_code    text;
  v_warnings      jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('player', 'coach', 'parent', 'club') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF COALESCE(trim(p->>'full_name'), '') = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Never allow switching an existing profile to a different role
  SELECT role::text INTO v_existing_role FROM public.profiles WHERE user_id = v_uid;
  IF v_existing_role IS NOT NULL AND v_existing_role <> v_role THEN
    RAISE EXCEPTION 'Profile already exists with a different role';
  END IF;

  -- ── Profile ────────────────────────────────────────────────
  INSERT INTO public.profiles (user_id, role, full_name, nationality)
  VALUES (v_uid, v_role::public.user_role, trim(p->>'full_name'), NULLIF(trim(COALESCE(p->>'nationality', '')), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET full_name   = EXCLUDED.full_name,
        nationality = COALESCE(EXCLUDED.nationality, profiles.nationality);

  -- ── Player ─────────────────────────────────────────────────
  IF v_role = 'player' AND p ? 'player_details' THEN
    INSERT INTO public.player_details
      (user_id, date_of_birth, position, current_club, age_group, shirt_number)
    VALUES (
      v_uid,
      NULLIF(p#>>'{player_details,date_of_birth}', '')::date,
      NULLIF(p#>>'{player_details,position}', ''),
      NULLIF(p#>>'{player_details,current_club}', ''),
      NULLIF(p#>>'{player_details,age_group}', ''),
      NULLIF(p#>>'{player_details,shirt_number}', '')::int
    )
    ON CONFLICT (user_id) DO UPDATE
      SET date_of_birth = COALESCE(EXCLUDED.date_of_birth, player_details.date_of_birth),
          position      = COALESCE(EXCLUDED.position, player_details.position),
          current_club  = COALESCE(EXCLUDED.current_club, player_details.current_club),
          age_group     = COALESCE(EXCLUDED.age_group, player_details.age_group),
          shirt_number  = COALESCE(EXCLUDED.shirt_number, player_details.shirt_number);

    -- Parent invite
    IF COALESCE(trim(p->>'parent_email'), '') <> '' THEN
      PERFORM public.create_parent_invite(p->>'parent_email');
    END IF;

    -- Coach linking (non-fatal: a bad code shouldn't fail signup)
    v_coach_code := COALESCE(trim(p->>'coach_invite_code'), '');
    IF v_coach_code <> '' THEN
      BEGIN
        PERFORM public.link_player_to_coach(v_coach_code);
      EXCEPTION WHEN OTHERS THEN
        v_warnings := v_warnings || to_jsonb(
          'Coach code "' || v_coach_code || '" was not recognised — you can link to your coach later in Settings.'
        );
      END;
    END IF;
  END IF;

  -- ── Coach ──────────────────────────────────────────────────
  IF v_role = 'coach' THEN
    -- Academy code lookup (non-fatal)
    v_org := NULL;
    v_academy_code := COALESCE(trim(p#>>'{coach_details,academy_code}'), '');
    IF v_academy_code <> '' THEN
      SELECT id INTO v_org
      FROM public.organizations
      WHERE upper(join_code) = upper(regexp_replace(v_academy_code, '^TRK-', '', 'i'));
      IF v_org IS NULL THEN
        v_warnings := v_warnings || to_jsonb(
          'Academy code "' || v_academy_code || '" was not recognised — you can join your academy later from your profile.'
        );
      END IF;
    END IF;

    INSERT INTO public.coach_details (user_id, current_club, team, coach_role, organization_id)
    VALUES (
      v_uid,
      NULLIF(p#>>'{coach_details,current_club}', ''),
      NULLIF(p#>>'{coach_details,team}', ''),
      NULLIF(p#>>'{coach_details,coach_role}', ''),
      v_org
    )
    ON CONFLICT (user_id) DO UPDATE
      SET current_club    = COALESCE(EXCLUDED.current_club, coach_details.current_club),
          team            = COALESCE(EXCLUDED.team, coach_details.team),
          coach_role      = COALESCE(EXCLUDED.coach_role, coach_details.coach_role),
          organization_id = COALESCE(EXCLUDED.organization_id, coach_details.organization_id);

    -- Invite code for players to link with
    UPDATE public.profiles
    SET invite_code = public.generate_unique_code('profile')
    WHERE user_id = v_uid AND invite_code IS NULL;
  END IF;

  -- ── Club admin ─────────────────────────────────────────────
  IF v_role = 'club' THEN
    IF COALESCE(trim(p#>>'{club_details,academy_name}'), '') = '' THEN
      RAISE EXCEPTION 'Academy name is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE admin_user_id = v_uid) THEN
      INSERT INTO public.organizations (admin_user_id, name, join_code)
      VALUES (v_uid, trim(p#>>'{club_details,academy_name}'), public.generate_unique_code('org'));
    END IF;
  END IF;

  -- ── Parent ─────────────────────────────────────────────────
  IF v_role = 'parent' AND v_email IS NOT NULL THEN
    PERFORM public.link_parent_to_players_by_email(v_email);
  END IF;

  RETURN jsonb_build_object('warnings', v_warnings);
END;
$fn$;

REVOKE ALL ON FUNCTION public.provision_my_profile(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_my_profile(jsonb) TO authenticated;

COMMIT;

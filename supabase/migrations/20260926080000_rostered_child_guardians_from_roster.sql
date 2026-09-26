-- TRAK-18 (G2): "A child cannot approve themselves, change their age or choose
-- their guardian's email." For a child the academy rostered (#128, #144), the
-- guardians are the roster's. Before this, a rostered child could still name
-- any adult, through create_parent_invite or the signup payload, and an
-- existing parent account at that address could accept the invitation, become
-- linked and consent for the child (reproduced: g2_roster_guardian_authority).
--
-- create_parent_invite: the 20260923200000 body, plus one check: a rostered
-- child may invite only a guardian address the roster names for them. That
-- keeps today's invitation email to the academy's guardian (until the TRAK-11
-- roster invitations replace it) while refusing any address the child picks.
-- provision_my_profile: the 20260925230000 (#144) body, plus one condition, so
-- a rostered child's non-roster parent_email is ignored rather than failing
-- their signup. Accounts from before the roster keep today's path (TRAK-11
-- spec boundary: ask first). Existing invitations are untouched; production
-- has no roster rows, so no rostered child has made one.
BEGIN;

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
  IF v_email = (SELECT lower(trim(u.email)) FROM auth.users u WHERE u.id = v_uid) THEN
    RAISE EXCEPTION 'Your parent''s email must be different from yours' USING ERRCODE = '22023';
  END IF;
  -- A rostered child's guardians are the academy's (G2): the child may invite
  -- only an address the roster already names for them, never one they choose.
  -- Claimed or not yet claimed (signup calls this before the claim), matched
  -- on the caller's confirmed email.
  IF EXISTS (
    SELECT 1 FROM public.roster_children rc
    WHERE rc.player_user_id = v_uid
       OR rc.child_email = (SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = v_uid)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.roster_children rc
    JOIN public.roster_guardians rg ON rg.roster_child_id = rc.id
    WHERE (rc.player_user_id = v_uid
           OR rc.child_email = (SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = v_uid))
      AND rg.email = v_email
  ) THEN
    RAISE EXCEPTION 'Your academy adds your parents or guardians' USING ERRCODE = '42501';
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
  v_confirmed     boolean;
  v_roster        public.roster_children%ROWTYPE;
  v_academy_name  text;
  v_age_group     text;
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

  -- Roster emails are stored lower(btrim()); compare the same way.
  SELECT lower(btrim(email)), email_confirmed_at IS NOT NULL INTO v_email, v_confirmed
  FROM auth.users WHERE id = v_uid;

  -- Never allow switching an existing profile to a different role
  SELECT role::text INTO v_existing_role FROM public.profiles WHERE user_id = v_uid;
  IF v_existing_role IS NOT NULL AND v_existing_role <> v_role THEN
    RAISE EXCEPTION 'Profile already exists with a different role';
  END IF;

  -- ── Admission (TRAK-48 slice 3, J1) ───────────────────────
  -- Only a NEW player or parent profile is checked; accounts that already
  -- exist keep working. Staff (coach, club) are out of scope (#74).
  IF v_existing_role IS NULL AND v_role = 'player' THEN
    SELECT rc.* INTO v_roster
    FROM public.roster_children rc
    WHERE v_confirmed AND rc.child_email = v_email
      AND (rc.player_user_id IS NULL OR rc.player_user_id = v_uid)
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your academy hasn''t added this email yet' USING ERRCODE = '42501';
    END IF;
    SELECT o.name INTO v_academy_name FROM public.organizations o WHERE o.id = v_roster.organization_id;
    SELECT sp.age_group INTO v_age_group FROM public.squad_players sp WHERE sp.id = v_roster.squad_player_id;
  ELSIF v_existing_role IS NULL AND v_role = 'parent' THEN
    IF NOT (v_confirmed AND EXISTS (SELECT 1 FROM public.roster_guardians rg WHERE rg.email = v_email)) THEN
      RAISE EXCEPTION 'Your academy hasn''t added this email yet' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── Profile ────────────────────────────────────────────────
  INSERT INTO public.profiles (user_id, role, full_name, nationality)
  VALUES (v_uid, v_role::public.user_role, trim(p->>'full_name'), NULLIF(trim(COALESCE(p->>'nationality', '')), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET full_name   = EXCLUDED.full_name,
        nationality = COALESCE(EXCLUDED.nationality, profiles.nationality);

  -- ── Player ─────────────────────────────────────────────────
  IF v_role = 'player' AND (p ? 'player_details' OR v_roster.id IS NOT NULL) THEN
    -- A rostered child: the roster's date of birth, academy and age group win
    -- over anything typed (J1, TRAK-54).
    INSERT INTO public.player_details
      (user_id, date_of_birth, position, current_club, age_group, shirt_number)
    VALUES (
      v_uid,
      COALESCE(v_roster.date_of_birth, NULLIF(p#>>'{player_details,date_of_birth}', '')::date),
      NULLIF(p#>>'{player_details,position}', ''),
      COALESCE(v_academy_name, NULLIF(p#>>'{player_details,current_club}', '')),
      COALESCE(v_age_group, NULLIF(p#>>'{player_details,age_group}', '')),
      NULLIF(p#>>'{player_details,shirt_number}', '')::int
    )
    ON CONFLICT (user_id) DO UPDATE
      SET date_of_birth = COALESCE(EXCLUDED.date_of_birth, player_details.date_of_birth),
          position      = COALESCE(EXCLUDED.position, player_details.position),
          current_club  = COALESCE(EXCLUDED.current_club, player_details.current_club),
          age_group     = COALESCE(EXCLUDED.age_group, player_details.age_group),
          shirt_number  = COALESCE(EXCLUDED.shirt_number, player_details.shirt_number);

    -- Parent invite. A rostered child's guardians are the academy's (G2,
    -- TRAK-18): an address the roster doesn't name for them is ignored, so it
    -- neither becomes an invitation nor fails their signup. A pre-roster
    -- account keeps today's path.
    IF COALESCE(trim(p->>'parent_email'), '') <> '' AND (v_roster.id IS NULL OR EXISTS (
      SELECT 1 FROM public.roster_guardians rg
      WHERE rg.roster_child_id = v_roster.id AND rg.email = lower(btrim(p->>'parent_email'))
    )) THEN
      PERFORM public.create_parent_invite(p->>'parent_email');
    END IF;

    -- A rostered child claims their roster place and squad row, and is linked
    -- to any guardian who signed up first.
    IF v_roster.id IS NOT NULL THEN
      UPDATE public.roster_children SET player_user_id = v_uid WHERE id = v_roster.id;
      UPDATE public.squad_players SET linked_player_id = v_uid
      WHERE id = v_roster.squad_player_id AND (linked_player_id IS NULL OR linked_player_id = v_uid);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'This roster place is linked to another account. Ask your academy.' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
      SELECT v_uid, rg.parent_user_id FROM public.roster_guardians rg
      WHERE rg.roster_child_id = v_roster.id AND rg.parent_user_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    END IF;

    -- Coach linking (non-fatal: a bad code shouldn't fail signup). A rostered
    -- child is already linked through the roster.
    v_coach_code := COALESCE(trim(p->>'coach_invite_code'), '');
    IF v_coach_code <> '' AND v_roster.id IS NULL THEN
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
    -- Claim every guardian row with this email, and link the children who
    -- have already signed up (siblings included). Children who sign up later
    -- are linked from their side.
    UPDATE public.roster_guardians SET parent_user_id = v_uid
    WHERE email = v_email AND v_confirmed AND (parent_user_id IS NULL OR parent_user_id = v_uid);
    INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
    SELECT rc.player_user_id, v_uid
    FROM public.roster_guardians rg JOIN public.roster_children rc ON rc.id = rg.roster_child_id
    WHERE rg.email = v_email AND rg.parent_user_id = v_uid AND rc.player_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    PERFORM public.link_parent_to_players_by_email(v_email);
  END IF;

  RETURN jsonb_build_object('warnings', v_warnings);
END;
$fn$;


REVOKE ALL ON FUNCTION public.create_parent_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_parent_invite(text) TO authenticated;
REVOKE ALL ON FUNCTION public.provision_my_profile(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_my_profile(jsonb) TO authenticated;

COMMIT;

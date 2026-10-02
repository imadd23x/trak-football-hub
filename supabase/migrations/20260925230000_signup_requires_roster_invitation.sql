-- TRAK-48 slice 3 (J1, decided by Imad 24 Sep 2026): only rostered children and
-- the guardians the academy supplied get a player or parent profile.
--
-- provision_my_profile is the only way to create one (#130 closed the direct
-- INSERT). For a NEW player or parent it now requires the caller's CONFIRMED
-- auth email to be on the academy roster (#128's roster_children /
-- roster_guardians); anyone else gets 42501 "Your academy hasn't added this
-- email yet". On success the roster wins over what the child typed: date of
-- birth, academy (TRAK-54) and age group. The child claims their roster row and
-- squad row; guardians claim their rows; parent-child links are made from
-- whichever side signs up second. Existing profiles are not re-checked, and
-- the coach, club and coach-code paths are unchanged (TRAK-53 / slice 2).
-- The body is 20260917205027's, with only those additions.
BEGIN;

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

    -- Parent invite
    IF COALESCE(trim(p->>'parent_email'), '') <> '' THEN
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

REVOKE ALL ON FUNCTION public.provision_my_profile(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_my_profile(jsonb) TO authenticated;

COMMIT;

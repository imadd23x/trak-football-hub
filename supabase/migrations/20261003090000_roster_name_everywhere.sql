-- TRAK-103 (J3, Imad's option A, 1 Oct): a rostered child's name is the
-- academy's roster name (squad_players.player_name), everywhere.
--
-- Found in TRAK-24 run 2 (1 Oct): a child typed "T Bones Jr." at sign-up. The
-- coach's Squad showed the roster name and the family saw the typed one, so
-- the two sides talked about different names, and a child could put any name
-- on their family's screens. A player could also rename themselves at any
-- time: the full_name column grant plus the own-row policy, used by Settings
-- and PlayerProfile.
--
-- 1. trak_private.roster_player_name(user): the roster name of the child this
--    account is (the claimed roster row, or before the claim the unclaimed row
--    for its confirmed email). NULL for anyone who isn't a rostered child.
-- 2. provision_my_profile (redefined from 20260926170000, one change): a
--    rostered child's profile gets the roster name and any typed name is
--    ignored; a guardian, staff member or pre-roster player still gives one.
--    Admission now refuses an unrostered child before the name check.
-- 3. profiles trigger: a rostered player's name is set to the roster name on
--    insert, and any update to another name is refused (42501), whatever
--    path it comes through.
-- 4. squad_players trigger: when the academy corrects player_name (a coach or
--    the operator), the claimed child's profile follows.
-- Parents, coaches and pre-roster players keep editing their own names. Prod
-- had 0 claimed roster children on 2 Oct, so the backfill changes nothing
-- today; it is here so a replay converges.

CREATE FUNCTION trak_private.roster_player_name(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT sp.player_name
  FROM public.roster_children rc
  JOIN public.squad_players sp ON sp.id = rc.squad_player_id
  WHERE rc.player_user_id = p_user_id
     OR (rc.player_user_id IS NULL AND rc.child_email = (
           SELECT lower(btrim(u.email)) FROM auth.users u
           WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL))
  ORDER BY (rc.player_user_id = p_user_id) DESC NULLS LAST, rc.loaded_at
  LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION trak_private.roster_player_name(uuid) FROM PUBLIC, anon, authenticated;

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
  v_warnings      jsonb := '[]'::jsonb;
  v_confirmed     boolean;
  v_roster        public.roster_children%ROWTYPE;
  v_academy_name  text;
  v_age_group     text;
  v_name          text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('player', 'coach', 'parent', 'club') THEN
    RAISE EXCEPTION 'Invalid role';
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

  -- TRAK-103: a rostered child's name is the academy's roster name; a typed
  -- one is ignored, and none is needed. Everyone else gives their own.
  v_name := NULLIF(trim(COALESCE(p->>'full_name', '')), '');
  IF v_role = 'player' THEN
    v_name := COALESCE(trak_private.roster_player_name(v_uid), v_name);
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  -- ── Profile ────────────────────────────────────────────────
  INSERT INTO public.profiles (user_id, role, full_name, nationality)
  VALUES (v_uid, v_role::public.user_role, v_name, NULLIF(trim(COALESCE(p->>'nationality', '')), ''))
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

    -- A player joins a squad only through the roster (TRAK-48 slice 4). A
    -- coach_invite_code in the payload is ignored: no linking by code.
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

CREATE FUNCTION trak_private.keep_roster_player_name()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_roster_name text;
BEGIN
  IF NEW.role IS DISTINCT FROM 'player'::public.user_role THEN RETURN NEW; END IF;
  v_roster_name := trak_private.roster_player_name(NEW.user_id);
  IF v_roster_name IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.full_name := v_roster_name;
  ELSIF NEW.full_name IS DISTINCT FROM v_roster_name THEN
    RAISE EXCEPTION 'Your academy sets your name. Ask them to correct it.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION trak_private.keep_roster_player_name() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_keep_roster_player_name
  BEFORE INSERT OR UPDATE OF full_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION trak_private.keep_roster_player_name();

CREATE FUNCTION trak_private.follow_roster_player_name()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  UPDATE public.profiles p SET full_name = NEW.player_name
  FROM public.roster_children rc
  WHERE rc.squad_player_id = NEW.id AND rc.player_user_id = p.user_id
    AND p.role = 'player' AND p.full_name IS DISTINCT FROM NEW.player_name;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION trak_private.follow_roster_player_name() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER squad_players_follow_roster_name
  AFTER UPDATE OF player_name ON public.squad_players
  FOR EACH ROW WHEN (OLD.player_name IS DISTINCT FROM NEW.player_name)
  EXECUTE FUNCTION trak_private.follow_roster_player_name();

-- Converge any claimed child whose profile name differs (0 rows on prod, 2 Oct).
UPDATE public.profiles p SET full_name = sp.player_name
FROM public.roster_children rc JOIN public.squad_players sp ON sp.id = rc.squad_player_id
WHERE rc.player_user_id = p.user_id AND p.role = 'player' AND p.full_name IS DISTINCT FROM sp.player_name;

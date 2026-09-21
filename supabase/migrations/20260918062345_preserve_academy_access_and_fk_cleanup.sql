-- F1/F6 follow-up to the K1/K2 departure review. Existing deployed migrations
-- remain unchanged. Keep academy history attached to its recorded academy,
-- permit actual FK cleanup, and preserve ordinary edits of linked players.

ALTER TABLE public.squad_players
  ADD COLUMN organization_deleted_at timestamptz;
COMMENT ON COLUMN public.squad_players.organization_deleted_at IS
  'Immutable closed-academy history marker, set by FK cleanup; NULL does not itself imply independent ownership.';

CREATE OR REPLACE FUNCTION public.player_in_my_org(p_player_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND public.is_club_admin()
     AND EXISTS (
       SELECT 1
       FROM public.squad_players sp
       JOIN public.organizations o ON o.id = sp.organization_id
       JOIN public.profiles p ON p.user_id = sp.linked_player_id
       WHERE sp.linked_player_id = p_player_user_id
         AND sp.organization_deleted_at IS NULL
         AND p.role = 'player'
         AND o.admin_user_id = auth.uid()
     );
$fn$;

REVOKE ALL ON FUNCTION public.player_in_my_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.player_in_my_org(uuid) TO authenticated;

-- Referential actions execute ordinary UPDATE statements and fire triggers.
-- Only a genuinely deleted/missing parent row permits its reference to clear.
-- No caller-controlled flag, JWT role, or trigger-depth escape is involved.
CREATE OR REPLACE FUNCTION public.pin_org_id_on_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
    RETURN NEW;
  END IF;
  NEW.organization_id := OLD.organization_id;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_squad_player_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.organization_deleted_at := OLD.organization_deleted_at;
    IF OLD.organization_deleted_at IS NOT NULL THEN
      NEW.organization_id := NULL;
      NEW.status := 'coach_departed';
      IF NEW.linked_player_id IS NOT NULL
         AND NEW.linked_player_id IS DISTINCT FROM OLD.linked_player_id THEN
        RAISE EXCEPTION 'Closed academy history cannot be linked to a new player'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    -- Clients cannot create, forge or clear the deletion marker.
    NEW.organization_deleted_at := NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL THEN
    IF NEW.organization_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
      -- Deleted-academy records are history, not independent-coach records.
      -- Otherwise the NULL-organization branch in ownership policies would
      -- restore access to a removed/transferred coach, notably released rows.
      NEW.status := 'coach_departed';
      NEW.organization_deleted_at := now();
      RETURN NEW;
    END IF;
    NEW.organization_id := OLD.organization_id;
  ELSIF NEW.coach_user_id IS NOT NULL THEN
    -- Preserve NULL -> academy adoption for genuine independent/orphan rows.
    SELECT cd.organization_id INTO NEW.organization_id
    FROM public.coach_details cd
    WHERE cd.user_id = NEW.coach_user_id;
  ELSE
    NEW.organization_id := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Trigger functions are internal. Existing triggers do not require the
-- requesting authenticated user to hold EXECUTE on their function.
REVOKE ALL ON FUNCTION public.pin_org_id_on_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_squad_player_org_id() FROM PUBLIC, anon, authenticated;

-- Repair references already orphaned by the old pinning triggers. Only absent
-- academy IDs are cleared; no valid history is reassigned to a coach's new org.
UPDATE public.squad_players sp SET organization_id = NULL
WHERE sp.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = sp.organization_id);
UPDATE public.coach_assessments ca SET organization_id = NULL
WHERE ca.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = ca.organization_id);
UPDATE public.recognition_awards ra SET organization_id = NULL
WHERE ra.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = ra.organization_id);

-- 00004's UPDATE check rejected an unchanged link whenever the player differed
-- from the coach. The existing enforce_self_linked_player trigger already
-- allows unchanged links and rejects assigning somebody else's UUID. Keep that
-- guard and every role/ownership/academy gate, without blocking normal edits.
DROP POLICY IF EXISTS "Coaches can update own squad players" ON public.squad_players;
CREATE POLICY "Coaches can update own squad players"
  ON public.squad_players FOR UPDATE TO authenticated
  USING (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND status <> 'coach_departed'
    AND (organization_id IS NULL OR organization_id = public.my_coach_organization_id())
  )
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND status <> 'coach_departed'
    AND (organization_id IS NULL OR organization_id = public.my_coach_organization_id())
  );

-- A SECURITY DEFINER onboarding RPC must not reactivate deleted-academy or
-- departed rows by name. Otherwise its UPDATE status='active' could revive
-- access despite the direct-table departure policies. Legitimate independent
-- NULL -> academy adoption remains supported; closed history gets a new row.
CREATE OR REPLACE FUNCTION public.link_player_to_coach(p_code text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_coach uuid;
  v_org uuid;
  v_sq uuid;
  v_name text;
  v_pos text;
  v_shirt int;
  v_ag text;
  v_match_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_uid AND role = 'player') THEN
    RAISE EXCEPTION 'Only a player can establish their coaching relationship'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT user_id INTO v_coach
  FROM public.profiles
  WHERE role = 'coach' AND invite_code IS NOT NULL
    AND upper(invite_code) = upper(regexp_replace(trim(p_code), '^TRK-', '', 'i'))
  LIMIT 1;
  IF v_coach IS NULL THEN RAISE EXCEPTION 'Invalid coach code'; END IF;

  -- Two concurrent calls from this player otherwise both observe no link and
  -- INSERT twice (or the loser of a stub UPDATE falls through to INSERT).
  -- Serialize only this authenticated player/coach pair before any lookup;
  -- the waiting call then sees the committed result and returns the same ID.
  -- The lock releases automatically on transaction end, including failures.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'trak.player-coach-link:' || v_uid::text || ':' || v_coach::text, 0
  ));
  SELECT organization_id INTO v_org FROM public.coach_details WHERE user_id = v_coach;

  SELECT id INTO v_sq FROM public.squad_players
  WHERE coach_user_id = v_coach AND linked_player_id = v_uid
    AND status <> 'coach_departed' AND organization_deleted_at IS NULL
    AND (organization_id IS NULL OR organization_id = v_org)
  LIMIT 1;
  IF v_sq IS NOT NULL THEN RETURN v_sq; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  SELECT position, shirt_number, age_group INTO v_pos, v_shirt, v_ag
  FROM public.player_details WHERE user_id = v_uid;
  IF COALESCE(trim(v_name), '') <> '' THEN
    SELECT count(*) INTO v_match_count FROM public.squad_players
    WHERE coach_user_id = v_coach AND linked_player_id IS NULL
      AND lower(trim(player_name)) = lower(trim(v_name))
      AND status <> 'coach_departed' AND organization_deleted_at IS NULL
      AND (organization_id IS NULL OR organization_id = v_org);
    IF v_match_count = 1 THEN
      UPDATE public.squad_players
      SET linked_player_id = v_uid,
          position = COALESCE(v_pos, position),
          shirt_number = COALESCE(v_shirt, shirt_number),
          age_group = COALESCE(v_ag, age_group),
          status = 'active'
      WHERE coach_user_id = v_coach AND linked_player_id IS NULL
        AND lower(trim(player_name)) = lower(trim(v_name))
        AND status <> 'coach_departed' AND organization_deleted_at IS NULL
        AND (organization_id IS NULL OR organization_id = v_org)
      RETURNING id INTO v_sq;
      IF v_sq IS NOT NULL THEN RETURN v_sq; END IF;
    END IF;
  END IF;

  INSERT INTO public.squad_players
    (coach_user_id, player_name, position, shirt_number, age_group, linked_player_id, status)
  VALUES (v_coach, COALESCE(v_name, 'Player'), v_pos, v_shirt, v_ag, v_uid, 'active')
  RETURNING id INTO v_sq;
  RETURN v_sq;
END;
$fn$;
REVOKE ALL ON FUNCTION public.link_player_to_coach(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_player_to_coach(text) TO authenticated;

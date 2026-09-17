-- ============================================================
-- K2 / X3: coach departure clears membership but leaves ownership IDs,
-- so a removed coach keeps access — and a transferred coach carries the
-- old academy's squad into the new one.
--
-- remove_coach_from_org() (20260608000004) does three things: nulls
-- coach_details.organization_id, marks the coach's active squad rows
-- 'coach_departed', and deletes their staff_compliance row. None of that
-- touches coach_user_id, and every coach policy is keyed on coach_user_id.
-- Verified against the live database on 17 Sept, after removal the coach
-- still:
--
--   * reads their whole old squad          squad_players       coach_user_id = auth.uid()
--   * reads every assessment they wrote    coach_assessments   coach_user_id = auth.uid()
--   * reads their awards, sessions, events same shape
--   * still passes is_coach(), because profiles.role is untouched, so they
--     can keep WRITING assessments and awards about those children
--   * can UPDATE squad_players and set status back from 'coach_departed'
--     to 'active', undoing their own removal
--
-- Only "Coaches can read own org" on organizations actually breaks, because
-- that one joins through coach_details.organization_id.
--
-- The transfer case is a second, separate leak. squad_player_in_my_org()
-- resolves a roster row's academy through coach_in_my_org(coach_user_id),
-- which reads the coach's CURRENT organization. Move a coach from academy A
-- to academy B by setting coach_details.organization_id, and every roster
-- row they still own becomes visible to academy B's admin — academy A's
-- children, read by academy B.
--
-- Fix, in two parts:
--   1. Departure: ownership alone stops granting access. squad_player_is_mine()
--      (from 20260917000001) gains a status check, and the coach policies
--      that are not already routed through it get one directly.
--   2. Transfer: a roster row's academy stops being derived from where its
--      coach works today. squad_players carries its own organization_id,
--      stamped on insert and pinned on update, so moving a coach moves the
--      coach and nothing else.
-- ============================================================


-- ── Part 1: departure ───────────────────────────────────────

-- Ownership now means "mine, and still mine". A row marked coach_departed
-- belongs to the academy, not to the coach who used to hold it. Every policy
-- that routes through this helper — assessments, awards, notes, attendance —
-- loses access in one edit.
CREATE OR REPLACE FUNCTION public.squad_player_is_mine(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.squad_players sp
    WHERE sp.id = p_squad_player_id
      AND sp.coach_user_id = auth.uid()
      AND sp.status <> 'coach_departed'
  );
$fn$;


-- squad_players: the departed rows themselves.
-- USING excludes them from SELECT, UPDATE and DELETE, which is also what
-- stops a removed coach setting status back to 'active'.
DROP POLICY IF EXISTS "Coaches can select own squad" ON public.squad_players;
CREATE POLICY "Coaches can select own squad"
  ON public.squad_players FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid() AND status <> 'coach_departed');

DROP POLICY IF EXISTS "Coaches can update own squad players" ON public.squad_players;
CREATE POLICY "Coaches can update own squad players"
  ON public.squad_players FOR UPDATE TO authenticated
  USING (coach_user_id = auth.uid() AND public.is_coach() AND status <> 'coach_departed')
  WITH CHECK (coach_user_id = auth.uid() AND public.is_coach() AND status <> 'coach_departed');

DROP POLICY IF EXISTS "Coaches can delete own squad players" ON public.squad_players;
CREATE POLICY "Coaches can delete own squad players"
  ON public.squad_players FOR DELETE TO authenticated
  USING (coach_user_id = auth.uid() AND status <> 'coach_departed');

-- A roster row cannot be born departed. Nothing legitimate creates one — every
-- row in the live table is 'active' — and without this a coach could insert a
-- row that is invisible to them but counted by the academy.
DROP POLICY IF EXISTS "Coaches can insert squad players" ON public.squad_players;
CREATE POLICY "Coaches can insert squad players"
  ON public.squad_players FOR INSERT TO authenticated
  WITH CHECK (coach_user_id = auth.uid() AND public.is_coach() AND status <> 'coach_departed');


-- coach_assessments / recognition_awards: reads were keyed on coach_user_id
-- alone, so a departed coach kept every record they had ever written about
-- the academy's children. Route them through the roster row instead.
DROP POLICY IF EXISTS "Coaches can select own assessments" ON public.coach_assessments;
CREATE POLICY "Coaches can select own assessments"
  ON public.coach_assessments FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid() AND public.squad_player_is_mine(squad_player_id));

DROP POLICY IF EXISTS "Coaches can select own awards" ON public.recognition_awards;
CREATE POLICY "Coaches can select own awards"
  ON public.recognition_awards FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid() AND public.squad_player_is_mine(squad_player_id));


-- coach_sessions and coach_calendar_events are deliberately NOT gated here.
-- They carry no academy and no player: they are the coach's own diary, and a
-- coach who leaves an academy keeps their own training plans the same way
-- they keep their account. What they must not keep is the academy's children,
-- and session_attendance — the table that joins a session to a roster row —
-- is already routed through squad_player_is_mine() by 20260917000001, so the
-- attendance rows go dark on departure while the session title does not.
-- FLAGGED FOR REVIEW: if the academy considers the session plan its own
-- property, this is the line to move, and it should move before the pilot.


-- remove_coach_from_org(): scope the membership clear to the admin's own org.
-- The EXISTS check above it already proves the coach belongs there, so this
-- is defensive rather than a live hole, but an unscoped UPDATE keyed only on
-- user_id is one edit away from becoming one.
CREATE OR REPLACE FUNCTION public.remove_coach_from_org(p_coach_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NOT public.is_club_admin() THEN
    RAISE EXCEPTION 'Not authorized — must be a club admin';
  END IF;

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE admin_user_id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for this admin';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.coach_details
    WHERE user_id = p_coach_user_id
      AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Coach does not belong to your organization';
  END IF;

  UPDATE public.coach_details
  SET organization_id = NULL
  WHERE user_id = p_coach_user_id
    AND organization_id = v_org_id;

  -- Mark the academy's roster rows as departed. Scoped to this academy, so a
  -- coach who also works elsewhere keeps that squad.
  UPDATE public.squad_players
  SET status = 'coach_departed'
  WHERE coach_user_id = p_coach_user_id
    AND status = 'active'
    AND organization_id IS NOT DISTINCT FROM v_org_id;

  DELETE FROM public.staff_compliance
  WHERE coach_user_id = p_coach_user_id
    AND organization_id = v_org_id;
END;
$$;


-- ── Part 2: transfer ────────────────────────────────────────

-- A roster row now records the academy it was created under, rather than
-- borrowing whichever academy its coach happens to work for today.
ALTER TABLE public.squad_players
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Backfill. Departed rows first, from the academy stamped on their own
-- assessments, because their coach's current organization is already wrong
-- for them. Everything else from the coach's present academy.
UPDATE public.squad_players sp
SET organization_id = ca.organization_id
FROM public.coach_assessments ca
WHERE ca.squad_player_id = sp.id
  AND ca.organization_id IS NOT NULL
  AND sp.organization_id IS NULL
  AND sp.status = 'coach_departed';

UPDATE public.squad_players sp
SET organization_id = cd.organization_id
FROM public.coach_details cd
WHERE cd.user_id = sp.coach_user_id
  AND sp.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_squad_players_organization_id
  ON public.squad_players (organization_id);


-- Stamp on insert from the coach's academy, and pin on update so a row
-- cannot be moved between academies from the client.
CREATE OR REPLACE FUNCTION public.set_squad_player_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.organization_id := OLD.organization_id;
  ELSIF NEW.coach_user_id IS NULL THEN
    NEW.organization_id := NULL;
  ELSE
    SELECT cd.organization_id INTO NEW.organization_id
    FROM public.coach_details cd
    WHERE cd.user_id = NEW.coach_user_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_set_squad_player_org ON public.squad_players;
CREATE TRIGGER trg_set_squad_player_org
  BEFORE INSERT OR UPDATE ON public.squad_players
  FOR EACH ROW EXECUTE FUNCTION public.set_squad_player_org_id();


-- Resolve a roster row's academy from the row, not from its coach.
-- The old three-argument helper took (id, coach_user_id, status) and reached
-- for the coach's current organization; the policy that calls it has to be
-- dropped before the function can go.
DROP POLICY IF EXISTS "Club admins read org squad players" ON public.squad_players;

CREATE OR REPLACE FUNCTION public.squad_player_in_my_org(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p_organization_id IS NOT NULL
     AND p_organization_id = public.my_organization_id();
$fn$;

REVOKE ALL ON FUNCTION public.squad_player_in_my_org(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.squad_player_in_my_org(uuid) TO authenticated;

CREATE POLICY "Club admins read org squad players"
  ON public.squad_players FOR SELECT TO authenticated
  USING (public.is_club_admin() AND public.squad_player_in_my_org(organization_id));

DROP FUNCTION IF EXISTS public.squad_player_in_my_org(uuid, uuid, text);

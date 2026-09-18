-- ============================================================
-- F3 and F2 from the K1/K2 departure audit
-- (docs/reviews/k1-k2-departure.md, Imad/Codex, 18 Sept).
--
-- K1 checked that the roster row a coach writes against belongs to them. It
-- never asked whether the coach was entitled to that row's player in the
-- first place, and it gated departure on a status value that departure does
-- not always set. Both are closed here.
--
-- ── F3: a user id must not establish a coaching relationship ──
--
-- squad_players INSERT read:
--     (coach_user_id = auth.uid() AND is_coach() AND status <> 'coach_departed')
--
-- Nothing constrains linked_player_id. So a coach — including one already
-- removed from the academy — can insert a NEW roster row carrying another
-- academy's child's user id, and every ownership check then passes, because
-- the coach genuinely owns the row they just made. Assessments written
-- against it reach the child: "Players read own assessments" matches on
-- linked_player_id. K1's ownership check is satisfied by a relationship the
-- coach asserted unilaterally.
--
-- The legitimate path is the player's own: link_player_to_coach() is called
-- BY the player with the coach's code, and sets linked_player_id = auth.uid()
-- on both the adoption UPDATE and the INSERT. So the rule that admits every
-- real linkage and no fabricated one is: linked_player_id may only ever be
-- set to the caller. You can link yourself; you cannot be linked by someone
-- else claiming your id.
--
-- Enforced twice, because the two paths are different: RLS for a coach's
-- direct writes, and a trigger for everything, since link_player_to_coach()
-- is SECURITY DEFINER and RLS does not apply inside it.
--
-- ── F2: departure must not depend on a status value ──
--
-- squad_players.status allows active, coach_departed, released and archived.
-- remove_coach_from_org() converts only 'active', and the K2 gate is
-- status <> 'coach_departed' — so a row a coach archives before leaving
-- survives removal untouched and stays readable and writable by them
-- afterwards, and after they join another academy they can keep writing
-- about the first academy's child.
--
-- Gating on a status the departing coach can set themselves was the mistake.
-- The durable fact is the academy on the row, which squad_players has carried
-- since 20260917000002 and which the coach cannot change. A coach may act on
-- a row when the row's academy is the academy they are in now. Removal nulls
-- coach_details.organization_id, so every row stamped with that academy stops
-- matching at once, whatever its status — and a transfer to academy B fails
-- the same comparison against rows stamped A.
--
-- A NULL on the row still matches, so an independent coach with no academy,
-- and legacy rows never stamped, keep working.
-- ============================================================


-- ── F3: only the caller may be linked ───────────────────────

CREATE OR REPLACE FUNCTION public.enforce_self_linked_player()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Unchanged, or cleared, is always fine: account deletion nulls this, and
  -- most updates never touch it.
  IF TG_OP = 'UPDATE' AND NEW.linked_player_id IS NOT DISTINCT FROM OLD.linked_player_id THEN
    RETURN NEW;
  END IF;
  IF NEW.linked_player_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- auth.uid() is NULL for service_role and for migrations, which are trusted
  -- and must keep working; this guards the authenticated paths.
  IF auth.uid() IS NOT NULL AND NEW.linked_player_id <> auth.uid() THEN
    RAISE EXCEPTION
      'A player can only be linked to a squad by that player. Ask them to enter the coach code.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enforce_self_linked_player ON public.squad_players;
CREATE TRIGGER trg_enforce_self_linked_player
  BEFORE INSERT OR UPDATE ON public.squad_players
  FOR EACH ROW EXECUTE FUNCTION public.enforce_self_linked_player();


-- ── F2: authority follows the academy, not the status ───────

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
      AND (
        sp.organization_id IS NULL
        OR sp.organization_id = public.my_coach_organization_id()
      )
  );
$fn$;


-- The squad_players policies are not routed through that helper, so they take
-- the same clause directly.

DROP POLICY IF EXISTS "Coaches can select own squad" ON public.squad_players;
CREATE POLICY "Coaches can select own squad"
  ON public.squad_players FOR SELECT TO authenticated
  USING (
    coach_user_id = auth.uid()
    AND status <> 'coach_departed'
    AND (organization_id IS NULL OR organization_id = public.my_coach_organization_id())
  );

DROP POLICY IF EXISTS "Coaches can insert squad players" ON public.squad_players;
CREATE POLICY "Coaches can insert squad players"
  ON public.squad_players FOR INSERT TO authenticated
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND status <> 'coach_departed'
    AND (linked_player_id IS NULL OR linked_player_id = auth.uid())
  );

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
    AND (linked_player_id IS NULL OR linked_player_id = auth.uid())
  );

DROP POLICY IF EXISTS "Coaches can delete own squad players" ON public.squad_players;
CREATE POLICY "Coaches can delete own squad players"
  ON public.squad_players FOR DELETE TO authenticated
  USING (
    coach_user_id = auth.uid()
    AND status <> 'coach_departed'
    AND (organization_id IS NULL OR organization_id = public.my_coach_organization_id())
  );


-- Departure also marks the rows it should have marked. The academy clause
-- above already revokes authority whatever the status, so this is bookkeeping
-- rather than the control — but the club's departed-roster view keys on
-- 'coach_departed', and leaving an archived row as 'active' misreports it.
--
-- 'released' is deliberately left alone: that player is no longer on the
-- squad, and overwriting it would lose why they left. The academy clause
-- denies the departed coach either way.
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

  UPDATE public.squad_players
  SET status = 'coach_departed'
  WHERE coach_user_id = p_coach_user_id
    AND status IN ('active', 'archived')
    AND organization_id IS NOT DISTINCT FROM v_org_id;

  DELETE FROM public.staff_compliance
  WHERE coach_user_id = p_coach_user_id
    AND organization_id = v_org_id;
END;
$$;

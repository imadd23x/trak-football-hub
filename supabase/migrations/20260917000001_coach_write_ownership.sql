-- ============================================================
-- K1 / X2: coach writes check the writer's ROLE but never their
-- OWNERSHIP of the row being referenced.
--
-- 20260614000001 closed the "are you a coach?" hole. It did not close
-- "is this YOUR player?". Verified against the live database on 17 Sept,
-- the INSERT policy on coach_assessments reads:
--
--   (coach_user_id = auth.uid())
--   AND is_coach()
--   AND (NOT squad_player_consent_required(squad_player_id))
--
-- Nothing constrains squad_player_id, session_id or organization_id. So a
-- coach signed in to academy B can:
--
--   1. insert a coach_assessment against a squad_player belonging to
--      academy A. The victim reads it — "Players read own assessments"
--      matches on squad_player_id alone — and DELETE is `false` on this
--      table ("No assessment deletion"), so the row is permanent and
--      cannot be removed through the app.
--   2. supply organization_id explicitly. The BEFORE INSERT trigger
--      set_assessment_org_id() only fills the column when it is NULL, so a
--      supplied value survives, and "Club admins read org assessments"
--      (organization_id = my_organization_id()) then shows that row on
--      another academy's dashboard.
--   3. reference another coach's session_id, since session_id is
--      unconstrained.
--
-- recognition_awards has all three holes in the same shape.
--
-- This is not only a cross-academy problem: two coaches in the SAME academy
-- can write to each other's players, because ownership is per coach.
--
-- Fix: ownership helpers, same SECURITY DEFINER pattern as is_coach(), so
-- the check cannot recurse through the referenced table's own RLS. The
-- triggers are hardened too, so organization_id is always derived from the
-- coach rather than trusted from the client — defence in depth with the
-- policy rather than a substitute for it.
--
-- NOTE: coach_details.user_id is UNIQUE, so "the coach's academy" is a
-- single value and the trigger and my_coach_organization_id() agree.
-- ============================================================


-- ── Ownership helpers ───────────────────────────────────────

-- Is this roster row held by the caller?
CREATE OR REPLACE FUNCTION public.squad_player_is_mine(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.squad_players sp
    WHERE sp.id = p_squad_player_id
      AND sp.coach_user_id = auth.uid()
  );
$fn$;

REVOKE ALL ON FUNCTION public.squad_player_is_mine(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.squad_player_is_mine(uuid) TO authenticated;


-- Is this session the caller's own?
CREATE OR REPLACE FUNCTION public.coach_session_is_mine(p_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_sessions cs
    WHERE cs.id = p_session_id
      AND cs.coach_user_id = auth.uid()
  );
$fn$;

REVOKE ALL ON FUNCTION public.coach_session_is_mine(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.coach_session_is_mine(uuid) TO authenticated;


-- The academy the caller coaches for. NULL for an independent coach with no
-- academy — which is a legitimate state, so the policies below compare with
-- IS NOT DISTINCT FROM rather than = to keep NULL = NULL true.
CREATE OR REPLACE FUNCTION public.my_coach_organization_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT cd.organization_id
  FROM public.coach_details cd
  WHERE cd.user_id = auth.uid()
  LIMIT 1;
$fn$;

REVOKE ALL ON FUNCTION public.my_coach_organization_id() FROM public;
GRANT EXECUTE ON FUNCTION public.my_coach_organization_id() TO authenticated;


-- ── Harden the org-stamping triggers ────────────────────────
-- Both previously ran `IF NEW.organization_id IS NULL`, which trusts a
-- client-supplied value. Always derive it from the coach on the row.

CREATE OR REPLACE FUNCTION public.set_assessment_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.coach_user_id IS NULL THEN
    NEW.organization_id := NULL;
  ELSE
    SELECT cd.organization_id INTO NEW.organization_id
    FROM public.coach_details cd
    WHERE cd.user_id = NEW.coach_user_id;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_award_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.coach_user_id IS NULL THEN
    NEW.organization_id := NULL;
  ELSE
    SELECT cd.organization_id INTO NEW.organization_id
    FROM public.coach_details cd
    WHERE cd.user_id = NEW.coach_user_id;
  END IF;
  RETURN NEW;
END;
$fn$;

-- The triggers only fire BEFORE INSERT, so an UPDATE could still move a row
-- to another academy. Pin organization_id on update as well.
CREATE OR REPLACE FUNCTION public.pin_org_id_on_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  NEW.organization_id := OLD.organization_id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_pin_assessment_org ON public.coach_assessments;
CREATE TRIGGER trg_pin_assessment_org
  BEFORE UPDATE ON public.coach_assessments
  FOR EACH ROW EXECUTE FUNCTION public.pin_org_id_on_update();

DROP TRIGGER IF EXISTS trg_pin_award_org ON public.recognition_awards;
CREATE TRIGGER trg_pin_award_org
  BEFORE UPDATE ON public.recognition_awards
  FOR EACH ROW EXECUTE FUNCTION public.pin_org_id_on_update();


-- ── coach_assessments ───────────────────────────────────────

DROP POLICY IF EXISTS "Coaches can insert assessments" ON public.coach_assessments;
CREATE POLICY "Coaches can insert assessments"
  ON public.coach_assessments FOR INSERT TO authenticated
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
    AND (session_id IS NULL OR public.coach_session_is_mine(session_id))
    AND organization_id IS NOT DISTINCT FROM public.my_coach_organization_id()
    AND NOT public.squad_player_consent_required(squad_player_id)
  );

DROP POLICY IF EXISTS "Coaches can update own assessments" ON public.coach_assessments;
CREATE POLICY "Coaches can update own assessments"
  ON public.coach_assessments FOR UPDATE TO authenticated
  USING (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
  )
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
    AND (session_id IS NULL OR public.coach_session_is_mine(session_id))
  );


-- ── recognition_awards ──────────────────────────────────────

DROP POLICY IF EXISTS "Coaches can insert awards" ON public.recognition_awards;
CREATE POLICY "Coaches can insert awards"
  ON public.recognition_awards FOR INSERT TO authenticated
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
    AND organization_id IS NOT DISTINCT FROM public.my_coach_organization_id()
    AND NOT public.squad_player_consent_required(squad_player_id)
  );

DROP POLICY IF EXISTS "Coaches can update own awards" ON public.recognition_awards;
CREATE POLICY "Coaches can update own awards"
  ON public.recognition_awards FOR UPDATE TO authenticated
  USING (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
  )
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
  );


-- ── coach_assessment_notes ──────────────────────────────────
-- Already checks ownership through coach_assessments. Restated so the guard
-- is visible in one place, and so UPDATE carries an explicit WITH CHECK
-- rather than relying on USING being reused.

DROP POLICY IF EXISTS "Coaches can insert assessment notes" ON public.coach_assessment_notes;
CREATE POLICY "Coaches can insert assessment notes"
  ON public.coach_assessment_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.is_coach()
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_assessment_notes.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
    )
  );

DROP POLICY IF EXISTS "Coaches can update own assessment notes" ON public.coach_assessment_notes;
CREATE POLICY "Coaches can update own assessment notes"
  ON public.coach_assessment_notes FOR UPDATE TO authenticated
  USING (
    public.is_coach()
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_assessment_notes.assessment_id
        AND ca.coach_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_coach()
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_assessment_notes.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
    )
  );


-- ── session_attendance ──────────────────────────────────────
-- Ownership of the session was already checked. Add is_coach() for symmetry
-- with every other coach write, and an explicit WITH CHECK on UPDATE so a
-- row cannot be moved to another coach's session.

DROP POLICY IF EXISTS "Coaches can insert attendance for own sessions" ON public.session_attendance;
CREATE POLICY "Coaches can insert attendance for own sessions"
  ON public.session_attendance FOR INSERT TO authenticated
  WITH CHECK (
    public.is_coach()
    AND public.coach_session_is_mine(session_id)
    AND public.squad_player_is_mine(squad_player_id)
  );

DROP POLICY IF EXISTS "Coaches can update attendance for own sessions" ON public.session_attendance;
CREATE POLICY "Coaches can update attendance for own sessions"
  ON public.session_attendance FOR UPDATE TO authenticated
  USING (
    public.is_coach()
    AND public.coach_session_is_mine(session_id)
  )
  WITH CHECK (
    public.is_coach()
    AND public.coach_session_is_mine(session_id)
    AND public.squad_player_is_mine(squad_player_id)
  );


-- ── Indexes supporting the new helpers ──────────────────────
-- squad_player_is_mine() and coach_session_is_mine() run per row on every
-- coach write. Both lookups are by primary key, but the ownership column is
-- the filter, so index it.

CREATE INDEX IF NOT EXISTS idx_squad_players_coach_user_id
  ON public.squad_players (coach_user_id);

CREATE INDEX IF NOT EXISTS idx_coach_sessions_coach_user_id
  ON public.coach_sessions (coach_user_id);

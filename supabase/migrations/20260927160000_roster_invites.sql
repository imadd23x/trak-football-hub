-- ============================================================
-- TRAK-11 phase 3 (J2/J3): who send-roster-invites may email for a roster
-- place, and a record of each delivery. Spec:
-- docs/superpowers/specs/2026-09-25-consent-first-admission-design.md.
--
-- Both functions are for the edge function's service-role client only. It
-- verifies the caller first (the service key for the operator, the JWT for a
-- guardian) and passes the guardian's id here; the rules live in SQL so they
-- are tested under the real schema. roster_children and roster_guardians keep
-- RLS on with no app-role grants.
-- ============================================================

-- For resend and audit. invited_at is the last delivery the provider accepted.
ALTER TABLE public.roster_children
  ADD COLUMN invited_at   timestamptz,
  ADD COLUMN invite_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.roster_guardians
  ADD COLUMN invited_at   timestamptz,
  ADD COLUMN invite_count integer NOT NULL DEFAULT 0;

-- p_guardian_user_id NULL is the operator (at admission, or after correcting
-- an address): every guardian who hasn't signed up, plus an adult child, who
-- needs no consent. Otherwise it is a guardian asking for the child's
-- invitation: only a guardian who claimed this roster place, only with their
-- own active consent (an adult needs none), and only until the child joins.
-- The first name and academy are for the email, never the full name.
CREATE OR REPLACE FUNCTION public.roster_invite_targets(p_roster_child_id uuid, p_guardian_user_id uuid DEFAULT NULL)
RETURNS TABLE (kind text, email text, first_name text, academy text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '' SET TimeZone = 'UTC'
AS $fn$
DECLARE
  v_child   public.roster_children%ROWTYPE;
  v_first   text;
  v_academy text;
  v_adult   boolean;
BEGIN
  SELECT rc.* INTO v_child FROM public.roster_children rc WHERE rc.id = p_roster_child_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_roster_child' USING ERRCODE = 'P0002';
  END IF;
  SELECT split_part(btrim(sp.player_name), ' ', 1) INTO v_first
  FROM public.squad_players sp WHERE sp.id = v_child.squad_player_id;
  SELECT o.name INTO v_academy FROM public.organizations o WHERE o.id = v_child.organization_id;
  v_adult := date_part('year', age(current_date, v_child.date_of_birth)) >= public.consent_threshold_age();

  IF p_guardian_user_id IS NULL THEN
    RETURN QUERY
      SELECT 'guardian'::text, rg.email, v_first, v_academy
      FROM public.roster_guardians rg
      WHERE rg.roster_child_id = v_child.id AND rg.parent_user_id IS NULL
      UNION ALL
      SELECT 'child'::text, v_child.child_email, v_first, v_academy
      WHERE v_adult AND v_child.player_user_id IS NULL;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roster_guardians rg
                 WHERE rg.roster_child_id = v_child.id AND rg.parent_user_id = p_guardian_user_id) THEN
    RAISE EXCEPTION 'not_guardian' USING ERRCODE = '42501';
  END IF;
  IF NOT v_adult AND NOT EXISTS (
    SELECT 1 FROM public.parental_consents c
    WHERE c.roster_child_id = v_child.id
      AND c.parent_user_id = p_guardian_user_id
      AND c.withdrawn_at IS NULL
      AND c.superseded_by IS NULL
      AND c.purposes->'coaching_records' = 'true'::jsonb
  ) THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT 'child'::text, v_child.child_email, v_first, v_academy
    WHERE v_child.player_user_id IS NULL;
END;
$fn$;

-- Called after the provider accepts a delivery, for the row it went to.
CREATE OR REPLACE FUNCTION public.mark_roster_invite_sent(p_roster_child_id uuid, p_kind text, p_email text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $fn$
  UPDATE public.roster_children SET invited_at = now(), invite_count = invite_count + 1
  WHERE p_kind = 'child' AND id = p_roster_child_id AND child_email = p_email;
  UPDATE public.roster_guardians SET invited_at = now(), invite_count = invite_count + 1
  WHERE p_kind = 'guardian' AND roster_child_id = p_roster_child_id AND email = p_email;
$fn$;

REVOKE ALL ON FUNCTION public.roster_invite_targets(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_roster_invite_sent(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_invite_targets(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_roster_invite_sent(uuid, text, text) TO service_role;

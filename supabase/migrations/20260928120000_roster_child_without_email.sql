-- TRAK-84 [J3], part 1: the academy's roster can hold a child without an
-- email (many under ~12 have none). The guardian creates the child's login
-- after consenting (part 2); until then nothing is sent to the child.
--
-- * child_email may be NULL. The normalization and shape checks still apply
--   when it is present, and '' is still refused, so a blank is only ever NULL.
-- * admit_roster_child stores a blank email as NULL, and identifies an
--   email-less child by academy + name + date of birth so a re-run of the same
--   file refuses the second copy.
-- * roster_invite_targets never returns a child target without an address.
-- Every other use compares child_email with an email, which NULL never matches.

ALTER TABLE public.roster_children ALTER COLUMN child_email DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.admit_roster_child(
  p_organization_id uuid,
  p_coach_user_id   uuid,
  p_child_name      text,
  p_age_group       text,
  p_date_of_birth   date,
  p_child_email     text,
  p_guardian_emails text[],
  p_loaded_by       text,
  p_source_file     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  -- TRAK-84: a blank email means the child has none (stored as NULL, never '').
  v_child_email text := NULLIF(lower(btrim(COALESCE(p_child_email, ''))), '');
  v_guardians   text[];
  v_squad_id    uuid;
  v_roster_id   uuid;
BEGIN
  IF btrim(COALESCE(p_child_name, '')) = '' THEN
    RAISE EXCEPTION 'The child''s name is required' USING ERRCODE = '22023';
  END IF;
  IF p_date_of_birth IS NULL THEN
    RAISE EXCEPTION 'The child''s date of birth is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.coach_details cd
    WHERE cd.user_id = p_coach_user_id AND cd.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'The coach does not work for this academy' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT e), '{}') INTO v_guardians
  FROM (SELECT lower(btrim(g)) AS e FROM unnest(COALESCE(p_guardian_emails, '{}')) g) s
  WHERE e <> '';
  IF cardinality(v_guardians) = 0 THEN
    RAISE EXCEPTION 'At least one guardian email is required' USING ERRCODE = '22023';
  END IF;
  IF v_child_email = ANY (v_guardians) THEN
    RAISE EXCEPTION 'A child''s email cannot also be a guardian''s email on the roster'
      USING ERRCODE = '23514';
  END IF;

  -- Without an email, the academy, name and date of birth identify the child,
  -- so a re-run of the same file refuses the second copy (the loader skips it).
  IF v_child_email IS NULL AND EXISTS (
    SELECT 1 FROM public.roster_children rc
    JOIN public.squad_players sp ON sp.id = rc.squad_player_id
    WHERE rc.organization_id = p_organization_id AND rc.child_email IS NULL
      AND rc.date_of_birth = p_date_of_birth
      AND lower(btrim(sp.player_name)) = lower(btrim(p_child_name))
  ) THEN
    RAISE EXCEPTION 'This child is already on the academy''s roster' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.squad_players (coach_user_id, player_name, age_group)
  VALUES (p_coach_user_id, btrim(p_child_name), NULLIF(btrim(COALESCE(p_age_group, '')), ''))
  RETURNING id INTO v_squad_id;

  INSERT INTO public.roster_children
    (organization_id, squad_player_id, date_of_birth, child_email, loaded_by, source_file)
  VALUES (p_organization_id, v_squad_id, p_date_of_birth, v_child_email, p_loaded_by, p_source_file)
  RETURNING id INTO v_roster_id;

  INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by)
  SELECT v_roster_id, e, p_loaded_by FROM unnest(v_guardians) e;

  RETURN v_roster_id;
END;
$fn$;

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
      WHERE v_adult AND v_child.player_user_id IS NULL AND v_child.child_email IS NOT NULL;
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
    WHERE v_child.player_user_id IS NULL AND v_child.child_email IS NOT NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admit_roster_child(uuid, uuid, text, text, date, text, text[], text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_roster_child(uuid, uuid, text, text, date, text, text[], text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.roster_invite_targets(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_invite_targets(uuid, uuid) TO service_role;

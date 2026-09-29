-- TRAK-11 (J2), follow-up to #196: a guardian's roster rows were claimed only
-- inside provision_my_profile, at first sign-up. A guardian who already has an
-- account and is later added for another child (a sibling loaded afterwards)
-- never claimed the new row, so get_roster_children_awaiting_consent() never
-- listed that child and J2's "one guardian can consent for siblings without a
-- second account" failed.
--
-- The parent app calls this before listing. It is the sign-up claim and no
-- wider: the caller has a parent profile and a confirmed email, and only
-- unclaimed rows with exactly that email are claimed. Children in those rows
-- who already have accounts are linked, as at sign-up. Returns the number of
-- rows claimed; anyone else claims nothing.
CREATE OR REPLACE FUNCTION public.claim_my_roster_guardian_rows()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text;
  v_claimed integer;
BEGIN
  SELECT lower(btrim(u.email)) INTO v_email
  FROM auth.users u
  JOIN public.profiles p ON p.user_id = u.id AND p.role = 'parent'
  WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.roster_guardians SET parent_user_id = v_uid
  WHERE email = v_email AND parent_user_id IS NULL;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
  SELECT rc.player_user_id, v_uid
  FROM public.roster_guardians rg JOIN public.roster_children rc ON rc.id = rg.roster_child_id
  WHERE rg.email = v_email AND rg.parent_user_id = v_uid AND rc.player_user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN v_claimed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_my_roster_guardian_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_roster_guardian_rows() TO authenticated;

COMMENT ON FUNCTION public.claim_my_roster_guardian_rows() IS
  'TRAK-11 J2: an existing parent claims roster guardian rows added for them after sign-up (same rule as provision_my_profile).';

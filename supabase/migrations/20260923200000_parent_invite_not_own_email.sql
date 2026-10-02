-- G5 / TRAK-52: a child cannot name their own address as their parent's.
--
-- Found on the 22 Sep use-case testing call: the same email was accepted for
-- the player and the parent. The invitation then goes to the child, never to
-- an adult, and the signup screen says a parent was asked. provision_my_profile
-- creates the signup invitation through this function, so one check covers
-- signup and the profile's "Invite" button.
--
-- Same body as 20260917205027, plus the own-email check. CREATE OR REPLACE
-- keeps the existing grants (authenticated only).
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

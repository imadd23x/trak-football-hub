-- TRAK-84 J3 part 2. Passwords are held only by Auth. Reservations survive
-- interrupted HTTP requests; a unique child and username prevent two identities.
CREATE TABLE public.child_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_child_id uuid NOT NULL UNIQUE REFERENCES public.roster_children(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{4,30}$' AND username ~ '[0-9]'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.child_logins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.child_logins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.child_logins TO service_role;

CREATE FUNCTION public.reserve_child_login(p_roster_child_id uuid, p_username text)
RETURNS TABLE(reservation_id uuid, username text, ready boolean, guardian_user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_parent uuid := auth.uid();
  v_child public.roster_children%ROWTYPE;
  v_login public.child_logins%ROWTYPE;
  v_username text := lower(btrim(p_username));
  v_name text;
BEGIN
  SELECT rc.* INTO v_child FROM public.roster_children rc
  WHERE rc.id=p_roster_child_id FOR UPDATE;
  IF v_parent IS NULL OR NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.roster_guardians rg JOIN public.profiles p ON p.user_id=rg.parent_user_id
    JOIN auth.users u ON u.id=p.user_id
    WHERE rg.roster_child_id=v_child.id AND rg.parent_user_id=v_parent
      AND p.role='parent' AND u.email_confirmed_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.parental_consents c WHERE c.roster_child_id=v_child.id
      AND c.parent_user_id=v_parent AND c.withdrawn_at IS NULL AND c.superseded_by IS NULL
      AND c.purposes->'coaching_records'='true'::jsonb
  ) THEN RAISE EXCEPTION 'Approve this child from your guardian account first' USING ERRCODE='42501'; END IF;
  IF v_username IS NULL OR v_username !~ '^[a-z0-9._-]{4,30}$' OR v_username !~ '[0-9]' THEN
    RAISE EXCEPTION 'Use 4–30 lowercase letters, numbers, dots, underscores or hyphens, including a number' USING ERRCODE='22023';
  END IF;
  SELECT lower(sp.player_name) INTO v_name FROM public.squad_players sp WHERE sp.id=v_child.squad_player_id;
  IF v_username IN (btrim(v_name), split_part(btrim(v_name),' ',1), regexp_replace(v_name,'[^a-z0-9]','','g')) THEN
    RAISE EXCEPTION 'Choose a username different from your child''s name' USING ERRCODE='22023';
  END IF;
  SELECT cl.* INTO v_login FROM public.child_logins cl WHERE cl.roster_child_id=v_child.id;
  IF FOUND THEN
    IF v_login.username<>v_username THEN
      RAISE EXCEPTION 'This child already has a reserved username; use that username' USING ERRCODE='23505';
    END IF;
    -- The caller has current approval. A pending reservation may be completed
    -- by either guardian, even when their new consent superseded the first.
    IF v_login.auth_user_id IS NULL AND v_login.created_by IS DISTINCT FROM v_parent THEN
      UPDATE public.child_logins SET created_by=v_parent WHERE id=v_login.id;
    END IF;
    RETURN QUERY SELECT v_login.id,v_login.username,v_login.auth_user_id IS NOT NULL,v_parent;
    RETURN;
  END IF;
  IF v_child.child_email IS NOT NULL OR v_child.player_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This child already has an email or account' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.child_logins(roster_child_id,username,created_by)
    VALUES(v_child.id,v_username,v_parent) RETURNING * INTO v_login;
  RETURN QUERY SELECT v_login.id,v_login.username,false,v_parent;
END $$;

-- Minimal, durable parent recovery state; no technical address/Auth object.
CREATE FUNCTION public.get_my_child_logins()
RETURNS TABLE(roster_child_id uuid, first_name text, username text, ready boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT rc.id, split_part(btrim(sp.player_name),' ',1),cl.username,cl.auth_user_id IS NOT NULL
 FROM public.roster_children rc JOIN public.squad_players sp ON sp.id=rc.squad_player_id
 LEFT JOIN public.child_logins cl ON cl.roster_child_id=rc.id
 WHERE (rc.child_email IS NULL OR cl.id IS NOT NULL) AND rc.player_user_id IS NULL
 AND EXISTS (SELECT 1 FROM public.roster_guardians rg JOIN public.profiles p ON p.user_id=rg.parent_user_id
   JOIN auth.users u ON u.id=p.user_id WHERE rg.roster_child_id=rc.id AND rg.parent_user_id=auth.uid()
     AND p.role='parent' AND u.email_confirmed_at IS NOT NULL)
 AND EXISTS (SELECT 1 FROM public.parental_consents c WHERE c.roster_child_id=rc.id
   AND c.parent_user_id=auth.uid() AND c.withdrawn_at IS NULL AND c.superseded_by IS NULL
   AND c.purposes->'coaching_records'='true'::jsonb)
 ORDER BY 2,1
$$;

-- Auth creates the confirmed identity and binds its reserved roster place in
-- the SAME database transaction. If consent was withdrawn or the roster changed,
-- Auth creation rolls back too. raw_app_meta_data is writable only by Auth admin.
CREATE FUNCTION public.bind_child_login_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_login public.child_logins%ROWTYPE; v_child public.roster_children%ROWTYPE;
  v_auth auth.users%ROWTYPE;
BEGIN
  -- Admin's INSERT precedes its metadata/confirmation UPDATEs. NEW contains
  -- that initial snapshot even when deferred; read the final row at commit.
  SELECT u.* INTO v_auth FROM auth.users u WHERE u.id=NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF lower(split_part(COALESCE(v_auth.email,''),'@',2))<>'child.trakfootball.com' THEN RETURN NEW; END IF;
  IF v_auth.raw_app_meta_data->'trak_child_login' IS DISTINCT FROM 'true'::jsonb
    OR COALESCE(v_auth.raw_app_meta_data->>'child_login_reservation','')!~ '^[0-9a-f-]{36}$'
    OR v_auth.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Use guardian-created login' USING ERRCODE='42501';
  END IF;
  SELECT cl.* INTO v_login FROM public.child_logins cl
    WHERE cl.id=(v_auth.raw_app_meta_data->>'child_login_reservation')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Login reservation unavailable' USING ERRCODE='42501'; END IF;
  SELECT rc.* INTO v_child FROM public.roster_children rc WHERE rc.id=v_login.roster_child_id FOR UPDATE;
  SELECT cl.* INTO v_login FROM public.child_logins cl WHERE cl.id=v_login.id FOR UPDATE;
  IF NOT FOUND OR v_login.auth_user_id IS NOT NULL OR v_child.child_email IS NOT NULL
    OR v_child.player_user_id IS NOT NULL OR v_auth.email<>v_login.username||'@child.trakfootball.com'
    OR v_auth.raw_app_meta_data->>'child_login_guardian' IS DISTINCT FROM v_login.created_by::text
    OR NOT EXISTS (SELECT 1 FROM public.roster_guardians rg JOIN public.profiles p ON p.user_id=rg.parent_user_id
      JOIN auth.users u ON u.id=p.user_id WHERE rg.roster_child_id=v_child.id AND rg.parent_user_id=v_login.created_by
      AND p.role='parent' AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Login reservation unavailable' USING ERRCODE='42501';
  END IF;
  -- Lock the same consent row a concurrent withdrawal updates, so authorization
  -- and creation have an unambiguous order rather than a stale pre-check.
  PERFORM 1 FROM public.parental_consents c WHERE c.roster_child_id=v_child.id
    AND c.parent_user_id=v_login.created_by AND c.withdrawn_at IS NULL AND c.superseded_by IS NULL
    AND c.purposes->'coaching_records'='true'::jsonb FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guardian approval is required' USING ERRCODE='42501'; END IF;
  UPDATE public.child_logins SET auth_user_id=v_auth.id WHERE id=v_login.id;
  UPDATE public.roster_children SET child_email=v_auth.email WHERE id=v_child.id;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER auth_bind_child_login AFTER INSERT ON auth.users
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.bind_child_login_identity();

-- The old function remains private behind this filter. It still chooses ordinary
-- guardian/child targets, including the existing-account fallback. No internal
-- address can become a provider target during the pre-profile interval.
ALTER FUNCTION public.roster_invite_targets(uuid,uuid) RENAME TO roster_email_invite_targets;
CREATE FUNCTION public.roster_invite_targets(p_roster_child_id uuid,p_guardian_user_id uuid DEFAULT NULL)
RETURNS TABLE(kind text,email text,first_name text,academy text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT t.kind,t.email,t.first_name,t.academy
 FROM public.roster_email_invite_targets(p_roster_child_id,p_guardian_user_id) t
 WHERE lower(split_part(t.email,'@',2))<>'child.trakfootball.com'
$$;
REVOKE ALL ON FUNCTION public.roster_email_invite_targets(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.roster_invite_targets(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.roster_invite_targets(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bind_child_login_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_child_login(uuid,text),public.get_my_child_logins() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_child_login(uuid,text),public.get_my_child_logins() TO authenticated;

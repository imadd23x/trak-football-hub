-- Draft staff admission cutover. Household admission, delivery and UI must be
-- integrated before release. No owner identity or existing user is auto-enrolled.
BEGIN;
CREATE SCHEMA trak_admission;
REVOKE ALL ON SCHEMA trak_admission FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE trak_admission.platform_owners (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE trak_admission.staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  staff_role text NOT NULL CHECK(staff_role IN ('club','coach')),
  recipient_email text NOT NULL CHECK(recipient_email=lower(btrim(recipient_email))),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  academy_name text,
  scope_key text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','revoked')),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  UNIQUE(issuer_id,request_id),
  CHECK((staff_role='coach' AND organization_id IS NOT NULL AND academy_name IS NULL)
    OR (staff_role='club' AND nullif(btrim(academy_name),'') IS NOT NULL))
);
CREATE INDEX staff_invites_pending_scope ON trak_admission.staff_invites(scope_key) WHERE state='pending';
CREATE TABLE trak_admission.staff_capabilities (
  backend integer NOT NULL, transaction_id bigint NOT NULL, actor uuid NOT NULL,
  staff_role text NOT NULL, organization_id uuid NOT NULL,
  PRIMARY KEY(backend,transaction_id)
);
ALTER TABLE trak_admission.platform_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE trak_admission.staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE trak_admission.staff_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA trak_admission FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION trak_admission.maintenance() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin')
    AND current_setting('role',true) IN ('none','postgres','supabase_admin');
$$;
CREATE FUNCTION trak_admission.has_staff_capability(p_user uuid,p_role text,p_org uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM trak_admission.staff_capabilities c
    WHERE c.backend=pg_backend_pid() AND c.transaction_id=txid_current() AND c.actor=auth.uid()
      AND c.actor=p_user AND c.staff_role=p_role AND (p_org IS NULL OR c.organization_id=p_org));
$$;

CREATE FUNCTION trak_admission.lock_issuer(p_issuer uuid,p_role text,p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM auth.users u WHERE u.id=p_issuer AND u.email_confirmed_at IS NOT NULL
    AND nullif(btrim(u.email),'') IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff invitation authority unavailable' USING ERRCODE='42501'; END IF;
  IF p_role='club' THEN
    PERFORM 1 FROM trak_admission.platform_owners o WHERE o.user_id=p_issuer AND o.enabled FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Platform owner required' USING ERRCODE='42501'; END IF;
  ELSIF p_role='coach' THEN
    PERFORM 1 FROM public.profiles p WHERE p.user_id=p_issuer AND p.role='club' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Academy administrator required' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.organizations o WHERE o.id=p_org AND o.admin_user_id=p_issuer FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Academy administrator required' USING ERRCODE='42501'; END IF;
  ELSE RAISE EXCEPTION 'Invalid staff role' USING ERRCODE='22023';
  END IF;
END;
$$;

CREATE FUNCTION public.issue_staff_invite(p_request_id uuid,p_role text,p_email text,
  p_organization_id uuid DEFAULT NULL,p_academy_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); recipient text:=lower(btrim(p_email)); academy text:=nullif(btrim(p_academy_name),'');
  scope text; token text; prior trak_admission.staff_invites%ROWTYPE; issued trak_admission.staff_invites%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_role IS NULL OR p_role NOT IN ('club','coach') OR recipient IS NULL
    OR length(recipient)>254 OR recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR (p_role='club' AND (p_organization_id IS NOT NULL OR academy IS NULL OR length(academy)>200))
    OR (p_role='coach' AND (p_organization_id IS NULL OR academy IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid staff invitation' USING ERRCODE='22023';
  END IF;
  PERFORM trak_admission.lock_issuer(actor,p_role,p_organization_id);
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND lower(btrim(email))=recipient) THEN
    RAISE EXCEPTION 'Invite a different recipient' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-request:'||actor::text||':'||p_request_id::text,0));
  SELECT * INTO prior FROM trak_admission.staff_invites WHERE issuer_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF prior.staff_role<>p_role OR prior.recipient_email<>recipient OR prior.academy_name IS DISTINCT FROM academy
      OR (p_role='coach' AND prior.organization_id IS DISTINCT FROM p_organization_id) THEN
      RAISE EXCEPTION 'Request already used for another invitation' USING ERRCODE='22023';
    END IF;
    -- A token is returned only when minted. An uncertain delivery can explicitly
    -- rotate it using a new request ID; retries do not create extra invitations.
    RETURN jsonb_build_object('invitation_id',prior.id,'state',prior.state,'expires_at',prior.expires_at,'replayed',true);
  END IF;
  -- Structured fields keep names containing delimiters in distinct scopes.
  scope:=jsonb_build_array('staff-scope',p_role,
    CASE WHEN p_role='coach' THEN p_organization_id ELSE actor END,academy,recipient)::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(scope,0));
  UPDATE trak_admission.staff_invites SET state='revoked',revoked_at=clock_timestamp() WHERE scope_key=scope AND state='pending';
  token:=gen_random_uuid()::text||gen_random_uuid()::text;
  INSERT INTO trak_admission.staff_invites(issuer_id,request_id,staff_role,recipient_email,organization_id,academy_name,scope_key,token_hash)
  VALUES(actor,p_request_id,p_role,recipient,p_organization_id,academy,scope,sha256(convert_to(token,'UTF8'))) RETURNING * INTO issued;
  RETURN jsonb_build_object('invitation_id',issued.id,'token',token,'state',issued.state,'expires_at',issued.expires_at,'replayed',false);
END;
$$;

CREATE FUNCTION public.accept_staff_invite(p_token text,p_full_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); invite trak_admission.staff_invites%ROWTYPE; recipient text;
  existing_role text; existing_org uuid; target_org uuid; org_name text;
BEGIN
  IF actor IS NULL OR p_token IS NULL OR length(p_token)<>72 THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  IF nullif(btrim(p_full_name),'') IS NULL OR length(p_full_name)>200 THEN
    RAISE EXCEPTION 'Full name is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE token_hash=sha256(convert_to(p_token,'UTF8'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  -- Lock verified identities in a consistent order. Shared locks preserve email
  -- verification while a per-recipient advisory lock serializes two invitations.
  PERFORM 1 FROM auth.users WHERE id IN (actor,invite.issuer_id) ORDER BY id FOR SHARE;
  SELECT lower(btrim(email)) INTO recipient FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL;
  IF recipient IS NULL OR recipient<>invite.recipient_email THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM trak_admission.lock_issuer(invite.issuer_id,invite.staff_role,invite.organization_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-recipient:'||actor::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(invite.scope_key,0));
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE id=invite.id FOR UPDATE;
  IF invite.state='accepted' AND invite.accepted_by=actor THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=actor AND role::text=invite.staff_role)
      OR (invite.staff_role='coach' AND NOT EXISTS(SELECT 1 FROM public.coach_details WHERE user_id=actor AND organization_id=invite.organization_id))
      OR (invite.staff_role='club' AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=invite.organization_id AND admin_user_id=actor)) THEN
      RAISE EXCEPTION 'Invitation cannot restore removed access' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('role',invite.staff_role,'organization_id',invite.organization_id,'replayed',true);
  END IF;
  IF invite.state<>'pending' OR invite.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT role::text INTO existing_role FROM public.profiles WHERE user_id=actor;
  IF existing_role IS NOT NULL AND existing_role<>invite.staff_role THEN
    RAISE EXCEPTION 'Existing account has another role' USING ERRCODE='42501';
  END IF;
  IF invite.staff_role='club' THEN
    IF EXISTS(SELECT 1 FROM public.organizations WHERE admin_user_id=actor) THEN
      RAISE EXCEPTION 'Administrator already assigned' USING ERRCODE='42501';
    END IF;
    target_org:=gen_random_uuid(); org_name:=invite.academy_name;
  ELSE
    SELECT organization_id INTO existing_org FROM public.coach_details WHERE user_id=actor;
    IF existing_org IS NOT NULL THEN RAISE EXCEPTION 'Coach already assigned' USING ERRCODE='42501'; END IF;
    target_org:=invite.organization_id;
    SELECT name INTO org_name FROM public.organizations WHERE id=target_org;
  END IF;
  INSERT INTO trak_admission.staff_capabilities VALUES(pg_backend_pid(),txid_current(),actor,invite.staff_role,target_org);
  INSERT INTO public.profiles(user_id,role,full_name) VALUES(actor,invite.staff_role::public.user_role,btrim(p_full_name))
    ON CONFLICT(user_id) DO NOTHING;
  IF invite.staff_role='club' THEN
    INSERT INTO public.organizations(id,admin_user_id,name,join_code)
      VALUES(target_org,actor,org_name,public.generate_unique_code('org'));
  ELSE
    INSERT INTO public.coach_details(user_id,current_club,organization_id) VALUES(actor,org_name,target_org)
      ON CONFLICT(user_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,current_club=EXCLUDED.current_club;
  END IF;
  DELETE FROM trak_admission.staff_capabilities WHERE backend=pg_backend_pid() AND transaction_id=txid_current();
  UPDATE trak_admission.staff_invites SET state='accepted',accepted_by=actor,accepted_at=clock_timestamp(),organization_id=target_org WHERE id=invite.id;
  RETURN jsonb_build_object('role',invite.staff_role,'organization_id',target_org,'replayed',false);
END;
$$;

CREATE FUNCTION public.revoke_staff_invite(p_invitation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invite trak_admission.staff_invites%ROWTYPE;
BEGIN
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE id=p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM trak_admission.lock_issuer(auth.uid(),invite.staff_role,invite.organization_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(invite.scope_key,0));
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE id=p_invitation_id FOR UPDATE;
  IF invite.state='accepted' THEN RAISE EXCEPTION 'Remove accepted staff through academy management' USING ERRCODE='22023'; END IF;
  UPDATE trak_admission.staff_invites SET state='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=p_invitation_id;
END;
$$;

CREATE FUNCTION trak_admission.guard_staff_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF trak_admission.maintenance() THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='profiles' THEN
    IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.role IS DISTINCT FROM OLD.role) THEN
      RAISE EXCEPTION 'Profile identity cannot change' USING ERRCODE='42501';
    END IF;
    IF TG_OP='INSERT' AND NEW.role::text IN ('coach','club')
      AND NOT trak_admission.has_staff_capability(NEW.user_id,NEW.role::text) THEN
      RAISE EXCEPTION 'Staff invitation required' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME='organizations' THEN
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.admin_user_id IS DISTINCT FROM OLD.admin_user_id) THEN
      RAISE EXCEPTION 'Academy identity cannot change' USING ERRCODE='42501';
    END IF;
    IF TG_OP='INSERT' AND NOT trak_admission.has_staff_capability(NEW.admin_user_id,'club',NEW.id) THEN
      RAISE EXCEPTION 'Owner-issued academy invitation required' USING ERRCODE='42501';
    END IF;
  ELSE
    IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Coach identity cannot change' USING ERRCODE='42501';
    END IF;
    IF TG_OP='INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      -- Existing authenticated departure is allowed; rejoining needs a new invite.
      IF TG_OP='UPDATE' AND NEW.organization_id IS NULL AND (auth.uid()=OLD.user_id OR EXISTS(
          SELECT 1 FROM public.organizations o JOIN public.profiles p ON p.user_id=o.admin_user_id
          WHERE o.id=OLD.organization_id AND o.admin_user_id=auth.uid() AND p.role='club')
          -- During the FK's ON DELETE SET NULL action the deleted academy is
          -- already absent. The FK prevents an app from manufacturing this state.
          OR (OLD.organization_id IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM public.organizations WHERE id=OLD.organization_id))) THEN RETURN NEW; END IF;
      IF NEW.organization_id IS NULL OR NOT trak_admission.has_staff_capability(NEW.user_id,'coach',NEW.organization_id) THEN
        RAISE EXCEPTION 'Academy coach invitation required' USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- AFTER INSERT distinguishes a new identity from an existing-row UPSERT.
-- Raising here still rolls back the entire statement, including other triggers.
-- UPDATE guards separately pin identity and academy on the conflict path.
CREATE TRIGGER admission_staff_insert_guard AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION trak_admission.guard_staff_write();
CREATE TRIGGER admission_staff_insert_guard AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION trak_admission.guard_staff_write();
CREATE TRIGGER admission_staff_insert_guard AFTER INSERT ON public.coach_details FOR EACH ROW EXECUTE FUNCTION trak_admission.guard_staff_write();
CREATE TRIGGER admission_staff_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION trak_admission.guard_staff_write();
CREATE TRIGGER admission_staff_guard BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION trak_admission.guard_staff_write();
CREATE TRIGGER admission_staff_guard BEFORE UPDATE ON public.coach_details FOR EACH ROW EXECUTE FUNCTION trak_admission.guard_staff_write();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA trak_admission FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_staff_invite(uuid,text,text,uuid,text),public.accept_staff_invite(text,text),public.revoke_staff_invite(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_staff_invite(uuid,text,text,uuid,text),public.accept_staff_invite(text,text),public.revoke_staff_invite(uuid) TO authenticated;
COMMIT;

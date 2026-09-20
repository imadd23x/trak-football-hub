-- Staff email orchestration and recipient-scoped activation reads.
-- No raw tokens or provider response bodies are persisted.
BEGIN;
ALTER TABLE trak_admission.staff_invites
  ADD COLUMN delivery_state text NOT NULL DEFAULT 'not_sent'
    CHECK(delivery_state IN ('not_sent','sending','sent','failed')),
  ADD COLUMN delivery_attempt_id uuid,
  ADD COLUMN delivery_started_at timestamptz,
  ADD COLUMN delivery_finished_at timestamptz;
CREATE INDEX staff_delivery_issuer_time ON trak_admission.staff_invites(issuer_id,delivery_started_at)
  WHERE delivery_started_at IS NOT NULL;

CREATE FUNCTION public.staff_invitation_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); owner_allowed boolean; academy_rows jsonb; invitation_rows jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL AND nullif(btrim(email),'') IS NOT NULL) THEN
    RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS(SELECT 1 FROM trak_admission.platform_owners WHERE user_id=actor AND enabled) INTO owner_allowed;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) ORDER BY o.name,o.id),'[]')
    INTO academy_rows FROM public.organizations o JOIN public.profiles p ON p.user_id=o.admin_user_id
    WHERE o.admin_user_id=actor AND p.role='club';
  SELECT coalesce(jsonb_agg(row.data ORDER BY row.created_at DESC,row.id),'[]') INTO invitation_rows FROM (
    SELECT i.id,i.created_at,jsonb_build_object('id',i.id,'role',i.staff_role,'email',i.recipient_email,
      'organization_id',i.organization_id,'academy_name',coalesce(i.academy_name,o.name),
      'state',i.state,'expires_at',i.expires_at,'created_at',i.created_at,'delivery_state',i.delivery_state) AS data
    FROM trak_admission.staff_invites i LEFT JOIN public.organizations o ON o.id=i.organization_id
    WHERE (i.staff_role='club' AND owner_allowed)
      OR (i.staff_role='coach' AND o.admin_user_id=actor AND EXISTS(
        SELECT 1 FROM public.profiles WHERE user_id=actor AND role='club'))
    ORDER BY i.created_at DESC,i.id LIMIT 50
  ) row;
  RETURN jsonb_build_object('can_invite_academies',owner_allowed,'academies',academy_rows,'invitations',invitation_rows);
END;
$$;

CREATE FUNCTION public.inspect_staff_invite(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); invite trak_admission.staff_invites%ROWTYPE; actor_email text;
BEGIN
  IF actor IS NULL OR p_token IS NULL OR length(p_token)<>72 THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT lower(btrim(email)) INTO actor_email FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL;
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE token_hash=sha256(convert_to(p_token,'UTF8'));
  IF NOT FOUND OR actor_email IS NULL OR actor_email<>invite.recipient_email THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM trak_admission.lock_issuer(invite.issuer_id,invite.staff_role,invite.organization_id);
  IF (invite.state='accepted' AND invite.accepted_by=actor) THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=actor AND role::text=invite.staff_role)
      OR (invite.staff_role='coach' AND NOT EXISTS(SELECT 1 FROM public.coach_details WHERE user_id=actor AND organization_id=invite.organization_id))
      OR (invite.staff_role='club' AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=invite.organization_id AND admin_user_id=actor)) THEN
      RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
    END IF;
  ELSIF invite.state<>'pending' OR invite.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE user_id=actor AND role::text<>invite.staff_role) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('role',invite.staff_role,'state',invite.state,'expires_at',invite.expires_at,
    'academy_name',coalesce(invite.academy_name,(SELECT name FROM public.organizations WHERE id=invite.organization_id)));
END;
$$;

CREATE FUNCTION public.staff_invite_delivery_status(p_invitation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invite trak_admission.staff_invites%ROWTYPE;
BEGIN
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE id=p_invitation_id AND issuer_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM trak_admission.lock_issuer(auth.uid(),invite.staff_role,invite.organization_id);
  RETURN jsonb_build_object('invitation_id',invite.id,'state',invite.state,'expires_at',invite.expires_at,
    'delivery_state',invite.delivery_state,'attempt_id',invite.delivery_attempt_id);
END;
$$;

CREATE FUNCTION public.claim_staff_invite_delivery(p_invitation_id uuid,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); invite trak_admission.staff_invites%ROWTYPE; attempt uuid;
BEGIN
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE id=p_invitation_id AND issuer_id=actor
    AND token_hash=sha256(convert_to(p_token,'UTF8'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM trak_admission.lock_issuer(actor,invite.staff_role,invite.organization_id);
  -- Serialize the email allowance for this issuer before checking quotas.
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-email:'||actor::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(invite.scope_key,0));
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE id=p_invitation_id FOR UPDATE;
  IF invite.state<>'pending' OR invite.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';
  END IF;
  IF invite.delivery_state<>'not_sent' THEN
    RETURN jsonb_build_object('dispatch',false,'delivery_state',invite.delivery_state,'attempt_id',invite.delivery_attempt_id);
  END IF;
  IF (SELECT count(*) FROM trak_admission.staff_invites WHERE issuer_id=actor
      AND delivery_started_at >= (date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))>=50
    OR EXISTS(SELECT 1 FROM trak_admission.staff_invites WHERE issuer_id=actor
      AND recipient_email=invite.recipient_email AND delivery_started_at>clock_timestamp()-interval '60 seconds') THEN
    RAISE EXCEPTION 'Staff email limit reached' USING ERRCODE='P0001';
  END IF;
  attempt:=gen_random_uuid();
  UPDATE trak_admission.staff_invites SET delivery_state='sending',delivery_attempt_id=attempt,delivery_started_at=clock_timestamp()
    WHERE id=p_invitation_id;
  RETURN jsonb_build_object('dispatch',true,'attempt_id',attempt,'email',invite.recipient_email,
    'role',invite.staff_role,'expires_at',invite.expires_at);
END;
$$;

-- Issuance/rotation and delivery allowance must commit together. A rejected
-- resend must not revoke the last working link while failing to send its replacement.
CREATE FUNCTION public.prepare_staff_invite_email(p_request_id uuid,p_role text,p_email text,
  p_organization_id uuid DEFAULT NULL,p_academy_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invite jsonb; claim jsonb;
BEGIN
  PERFORM trak_admission.lock_issuer(auth.uid(),p_role,p_organization_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-email:'||auth.uid()::text,0));
  invite:=public.issue_staff_invite(p_request_id,p_role,p_email,p_organization_id,p_academy_name);
  IF (invite->>'replayed')::boolean THEN RETURN invite; END IF;
  claim:=public.claim_staff_invite_delivery((invite->>'invitation_id')::uuid,invite->>'token');
  RETURN invite||claim;
END;
$$;

-- Only the trusted mail adapter can record a provider outcome. A successful
-- provider response means accepted for sending, not inbox delivery.
CREATE FUNCTION public.finish_staff_invite_delivery(p_invitation_id uuid,p_attempt_id uuid,p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invite trak_admission.staff_invites%ROWTYPE;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent','failed') THEN RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO invite FROM trak_admission.staff_invites WHERE id=p_invitation_id AND delivery_attempt_id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery attempt unavailable' USING ERRCODE='42501'; END IF;
  IF invite.delivery_state=p_outcome THEN RETURN; END IF;
  IF invite.delivery_state<>'sending' THEN RAISE EXCEPTION 'Delivery outcome already recorded' USING ERRCODE='22023'; END IF;
  UPDATE trak_admission.staff_invites SET delivery_state=p_outcome,delivery_finished_at=clock_timestamp() WHERE id=p_invitation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_invitation_context(),public.inspect_staff_invite(text),
  public.staff_invite_delivery_status(uuid),public.claim_staff_invite_delivery(uuid,text),
  public.finish_staff_invite_delivery(uuid,uuid,text),public.prepare_staff_invite_email(uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_invitation_context(),public.inspect_staff_invite(text),
  public.staff_invite_delivery_status(uuid),public.claim_staff_invite_delivery(uuid,text),
  public.prepare_staff_invite_email(uuid,text,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_staff_invite_delivery(uuid,uuid,text) TO service_role;
COMMIT;

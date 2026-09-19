-- P2 authority foundation. No existing gate is redirected in this migration.
-- No academy is enabled and no notice is fabricated or legacy consent copied.
BEGIN;
CREATE SCHEMA trak_consent;
REVOKE ALL ON SCHEMA trak_consent FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE trak_consent.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  academy_name text NOT NULL CHECK (btrim(academy_name) <> ''),
  controller_name text NOT NULL CHECK (btrim(controller_name) <> ''),
  country_code text NOT NULL CHECK (country_code IN ('GR', 'AE')),
  version text NOT NULL CHECK (btrim(version) <> ''),
  body text NOT NULL CHECK (btrim(body) <> ''),
  approved_at timestamptz NOT NULL,
  approval_reference text NOT NULL CHECK (btrim(approval_reference) <> ''),
  UNIQUE (organization_id, version),
  UNIQUE (organization_id, id)
);
CREATE TABLE trak_consent.programs (
  organization_id uuid PRIMARY KEY,
  notice_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  FOREIGN KEY (organization_id, notice_id) REFERENCES trak_consent.notices(organization_id, id)
);
-- No cascading references to live users/academies: changing membership or
-- deleting an account must not silently destroy the evidence. The full P2
-- release still requires the reviewed retention/export/erasure implementation.
CREATE TABLE trak_consent.scopes (
  player_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (player_user_id, organization_id)
);
CREATE TABLE trak_consent.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  parent_user_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  request_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('grant', 'withdraw')),
  notice_id uuid NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('parent', 'legal_guardian')),
  purposes jsonb NOT NULL CHECK (
    jsonb_typeof(purposes) = 'object'
    AND purposes ?& ARRAY['coaching_records','recognition','parent_visibility']
    AND (purposes - ARRAY['coaching_records','recognition','parent_visibility']) = '{}'::jsonb
    AND jsonb_typeof(purposes->'coaching_records') = 'boolean'
    AND jsonb_typeof(purposes->'recognition') = 'boolean'
    AND jsonb_typeof(purposes->'parent_visibility') = 'boolean'
    AND ((action = 'grant' AND purposes->'coaching_records' = 'true'::jsonb)
      OR (action = 'withdraw' AND purposes = '{"coaching_records":false,"recognition":false,"parent_visibility":false}'::jsonb))
  ),
  player_age_at_decision integer,
  threshold_age integer NOT NULL DEFAULT 18 CHECK (threshold_age = 18),
  email_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (parent_user_id, request_id),
  UNIQUE (player_user_id, organization_id, revision),
  UNIQUE (player_user_id, organization_id, parent_user_id, id),
  FOREIGN KEY (player_user_id, organization_id) REFERENCES trak_consent.scopes,
  FOREIGN KEY (organization_id, notice_id) REFERENCES trak_consent.notices(organization_id, id)
);
CREATE TABLE trak_consent.decisions (
  player_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  parent_user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  PRIMARY KEY (player_user_id, organization_id, parent_user_id),
  FOREIGN KEY (player_user_id, organization_id, parent_user_id, event_id)
    REFERENCES trak_consent.events(player_user_id, organization_id, parent_user_id, id)
);
CREATE INDEX consent_decisions_parent ON trak_consent.decisions(parent_user_id, player_user_id, organization_id);

ALTER TABLE trak_consent.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE trak_consent.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trak_consent.scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trak_consent.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trak_consent.decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA trak_consent FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION trak_consent.immutable_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION 'Consent evidence is immutable; append a new decision or notice' USING ERRCODE = '55000';
END;
$fn$;
CREATE TRIGGER consent_notice_immutable BEFORE UPDATE OR DELETE ON trak_consent.notices
FOR EACH ROW EXECUTE FUNCTION trak_consent.immutable_evidence();
CREATE TRIGGER consent_event_immutable BEFORE UPDATE OR DELETE ON trak_consent.events
FOR EACH ROW EXECUTE FUNCTION trak_consent.immutable_evidence();

-- Internal predicate: never granted to app roles. Any eligible guardian may
-- approve each purpose for the academy, including all linked parents' visibility.
CREATE FUNCTION trak_consent.has_guardian_approval(p_child uuid, p_org uuid, p_purpose text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $fn$
  SELECT p_purpose IN ('coaching_records', 'recognition', 'parent_visibility') AND EXISTS (
    SELECT 1 FROM trak_consent.decisions d
    JOIN trak_consent.events e ON e.id = d.event_id
    JOIN trak_consent.programs pr ON pr.organization_id = d.organization_id
      AND pr.notice_id = e.notice_id AND pr.enabled
    JOIN public.organizations o ON o.id = pr.organization_id
    JOIN public.profiles child ON child.user_id=d.player_user_id AND child.role='player'
    JOIN public.player_details age_record ON age_record.user_id=d.player_user_id
      AND age_record.date_of_birth <= (statement_timestamp() AT TIME ZONE 'UTC')::date
      AND date_part('year', age((statement_timestamp() AT TIME ZONE 'UTC')::date, age_record.date_of_birth)) < 18
    JOIN auth.users u ON u.id = d.parent_user_id AND u.email_confirmed_at IS NOT NULL
      AND NULLIF(btrim(u.email), '') IS NOT NULL
    JOIN public.profiles p ON p.user_id = u.id AND p.role = 'parent'
    JOIN public.player_parent_links l ON l.parent_user_id = d.parent_user_id
      AND l.player_user_id = d.player_user_id
    WHERE d.player_user_id = p_child AND d.organization_id = p_org
      AND e.action = 'grant' AND e.purposes->p_purpose = 'true'::jsonb
  );
$fn$;

CREATE FUNCTION trak_consent.parent_context(p_child uuid, p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_parent uuid := auth.uid(); v_linked boolean; v_event trak_consent.events;
  v_notice trak_consent.notices; v_enabled boolean := false; v_age integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users u JOIN public.profiles p ON p.user_id=u.id
      WHERE u.id=v_parent AND p.role='parent' AND u.email_confirmed_at IS NOT NULL
      AND NULLIF(btrim(u.email),'') IS NOT NULL) THEN
    RAISE EXCEPTION 'A verified parent account is required' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.player_parent_links l
    WHERE l.player_user_id=p_child AND l.parent_user_id=v_parent) INTO v_linked;
  SELECT e.* INTO v_event FROM trak_consent.decisions d
    JOIN trak_consent.events e ON e.id=d.event_id
    WHERE d.player_user_id=p_child AND d.organization_id=p_org AND d.parent_user_id=v_parent;
  IF NOT v_linked AND v_event.id IS NULL THEN
    RAISE EXCEPTION 'Consent context is unavailable' USING ERRCODE='42501';
  END IF;
  SELECT n.* INTO v_notice
    FROM trak_consent.programs pr JOIN trak_consent.notices n ON n.id=pr.notice_id
    JOIN public.organizations o ON o.id=pr.organization_id
    WHERE pr.organization_id=p_org;
  SELECT enabled INTO v_enabled FROM trak_consent.programs WHERE organization_id=p_org;
  v_enabled := COALESCE(v_enabled,false) AND v_notice.id IS NOT NULL;
  IF v_linked THEN
    SELECT CASE WHEN pd.date_of_birth <= (statement_timestamp() AT TIME ZONE 'UTC')::date
      THEN date_part('year', age((statement_timestamp() AT TIME ZONE 'UTC')::date, pd.date_of_birth))::integer END
      INTO v_age FROM public.player_details pd WHERE pd.user_id=p_child;
  END IF;
  RETURN jsonb_build_object('player_user_id',p_child,'organization_id',p_org,
    'age',v_age,'threshold',18,'linked',v_linked,'enabled',COALESCE(v_enabled,false),
    'notice',CASE WHEN v_linked AND v_notice.id IS NOT NULL THEN jsonb_build_object(
      'id',v_notice.id,'version',v_notice.version,'body',v_notice.body,
      'academy_name',v_notice.academy_name,'controller_name',v_notice.controller_name,
      'country_code',v_notice.country_code) ELSE NULL END,
    'current_event_id',v_event.id,'action',v_event.action,'purposes',v_event.purposes,
    'coaching_approved',v_linked AND trak_consent.has_guardian_approval(p_child,p_org,'coaching_records'),
    'recognition_approved',v_linked AND trak_consent.has_guardian_approval(p_child,p_org,'recognition'),
    'parent_visibility_approved',v_linked AND trak_consent.has_guardian_approval(p_child,p_org,'parent_visibility'));
END;
$fn$;

CREATE FUNCTION trak_consent.record_decision(p_child uuid, p_org uuid, p_action text,
  p_request_id uuid, p_expected_event_id uuid, p_notice_id uuid, p_relationship text, p_purposes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_parent uuid := auth.uid(); v_verified timestamptz; v_current trak_consent.events;
  v_retry trak_consent.events; v_notice uuid; v_enabled boolean; v_age integer; v_dob date;
  v_revision bigint; v_event uuid; v_payload jsonb; v_result jsonb;
BEGIN
  SELECT u.email_confirmed_at INTO v_verified FROM auth.users u
    JOIN public.profiles p ON p.user_id=u.id
    WHERE u.id=v_parent AND p.role='parent' AND u.email_confirmed_at IS NOT NULL
      AND NULLIF(btrim(u.email),'') IS NOT NULL FOR SHARE OF u,p;
  IF v_verified IS NULL THEN
    RAISE EXCEPTION 'A verified parent account is required' USING ERRCODE='42501';
  END IF;
  IF p_child IS NULL OR p_org IS NULL OR p_request_id IS NULL
    OR p_action IS NULL OR p_action NOT IN ('grant','withdraw') THEN
    RAISE EXCEPTION 'Child, academy, request ID and valid action are required' USING ERRCODE='22023';
  END IF;
  v_payload := jsonb_build_object('child',p_child,'academy',p_org,'action',p_action,
    'expected_event',p_expected_event_id,'notice',p_notice_id,'relationship',p_relationship,'purposes',p_purposes);
  -- Serialize a request ID even if a caller mistakenly reuses it across scopes.
  PERFORM pg_advisory_xact_lock(hashtextextended('trak-consent:'||v_parent::text||':'||p_request_id::text,0));
  INSERT INTO trak_consent.scopes(player_user_id,organization_id) VALUES(p_child,p_org) ON CONFLICT DO NOTHING;
  SELECT revision INTO v_revision FROM trak_consent.scopes
    WHERE player_user_id=p_child AND organization_id=p_org FOR UPDATE;
  SELECT e.* INTO v_current FROM trak_consent.decisions d JOIN trak_consent.events e ON e.id=d.event_id
    WHERE d.player_user_id=p_child AND d.organization_id=p_org AND d.parent_user_id=v_parent;
  SELECT * INTO v_retry FROM trak_consent.events WHERE parent_user_id=v_parent AND request_id=p_request_id;
  IF v_retry.id IS NOT NULL THEN
    IF v_retry.request_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'Request ID already belongs to a different decision' USING ERRCODE='22023';
    END IF;
    RETURN trak_consent.parent_context(p_child,p_org) || jsonb_build_object('event_id',v_retry.id,'replayed',true,'revision',v_revision);
  END IF;
  IF v_current.id IS DISTINCT FROM p_expected_event_id THEN
    RAISE EXCEPTION 'Consent changed; refresh before submitting another decision' USING ERRCODE='40001';
  END IF;
  IF p_action='grant' THEN
    IF p_notice_id IS NULL OR p_relationship IS NULL OR p_relationship NOT IN ('parent','legal_guardian')
      OR p_purposes IS NULL OR jsonb_typeof(p_purposes)<>'object'
      OR NOT (p_purposes ?& ARRAY['coaching_records','recognition','parent_visibility'])
      OR (p_purposes - ARRAY['coaching_records','recognition','parent_visibility']) <> '{}'::jsonb
      OR p_purposes->'coaching_records' IS DISTINCT FROM 'true'::jsonb
      OR jsonb_typeof(p_purposes->'recognition') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(p_purposes->'parent_visibility') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'A notice, relationship and exact boolean purpose choices are required' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.player_parent_links l WHERE l.player_user_id=p_child AND l.parent_user_id=v_parent FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A current parent-child link is required' USING ERRCODE='42501'; END IF;
    SELECT pd.date_of_birth INTO v_dob FROM public.player_details pd
      JOIN public.profiles p ON p.user_id=pd.user_id AND p.role='player'
      WHERE pd.user_id=p_child FOR SHARE OF pd,p;
    IF v_dob IS NULL OR v_dob > (statement_timestamp() AT TIME ZONE 'UTC')::date THEN
      RAISE EXCEPTION 'A valid child date of birth is required' USING ERRCODE='22023';
    END IF;
    v_age := date_part('year',age((statement_timestamp() AT TIME ZONE 'UTC')::date,v_dob))::integer;
    IF v_age >= 18 THEN RAISE EXCEPTION 'This guardian approval is for children under 18' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.squad_players sp WHERE sp.linked_player_id=p_child AND sp.organization_id=p_org LIMIT 1 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The child is not on this academy roster' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.organizations o WHERE o.id=p_org FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Academy consent is unavailable' USING ERRCODE='42501'; END IF;
    SELECT notice_id,enabled INTO v_notice,v_enabled FROM trak_consent.programs WHERE organization_id=p_org FOR SHARE;
    IF NOT COALESCE(v_enabled,false) OR v_notice IS DISTINCT FROM p_notice_id THEN
      RAISE EXCEPTION 'The current approved academy notice is required' USING ERRCODE='42501';
    END IF;
  ELSE
    IF v_current.id IS NULL THEN RAISE EXCEPTION 'There is no decision to withdraw' USING ERRCODE='22023'; END IF;
    IF p_notice_id IS NOT NULL OR p_relationship IS NOT NULL OR p_purposes IS NOT NULL THEN
      RAISE EXCEPTION 'Withdrawal takes no replacement notice or purpose choices' USING ERRCODE='22023';
    END IF;
    p_notice_id := v_current.notice_id;
    p_relationship := v_current.relationship;
    p_purposes := '{"coaching_records":false,"recognition":false,"parent_visibility":false}'::jsonb;
  END IF;
  UPDATE trak_consent.scopes SET revision=revision+1 WHERE player_user_id=p_child AND organization_id=p_org RETURNING revision INTO v_revision;
  INSERT INTO trak_consent.events(player_user_id,organization_id,parent_user_id,revision,request_id,request_payload,
    action,notice_id,relationship,purposes,player_age_at_decision,email_verified_at)
    VALUES(p_child,p_org,v_parent,v_revision,p_request_id,v_payload,p_action,p_notice_id,p_relationship,p_purposes,v_age,v_verified)
    RETURNING id INTO v_event;
  INSERT INTO trak_consent.decisions(player_user_id,organization_id,parent_user_id,event_id)
    VALUES(p_child,p_org,v_parent,v_event)
    ON CONFLICT(player_user_id,organization_id,parent_user_id) DO UPDATE SET event_id=EXCLUDED.event_id;
  v_result := trak_consent.parent_context(p_child,p_org);
  RETURN v_result || jsonb_build_object('event_id',v_event,'replayed',false,'revision',v_revision);
END;
$fn$;

CREATE FUNCTION public.get_academy_consent_context(p_child uuid,p_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
  SELECT trak_consent.parent_context(p_child,p_org);
$fn$;
CREATE FUNCTION public.record_academy_consent(p_child uuid,p_org uuid,p_request_id uuid,
  p_expected_event_id uuid,p_notice_id uuid,p_relationship text,p_purposes jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT trak_consent.record_decision(p_child,p_org,'grant',p_request_id,p_expected_event_id,p_notice_id,p_relationship,p_purposes);
$fn$;
CREATE FUNCTION public.withdraw_academy_consent(p_child uuid,p_org uuid,p_request_id uuid,p_expected_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT trak_consent.record_decision(p_child,p_org,'withdraw',p_request_id,p_expected_event_id,NULL,NULL,NULL);
$fn$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA trak_consent FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA trak_consent TO authenticated;
GRANT EXECUTE ON FUNCTION trak_consent.parent_context(uuid,uuid),
  trak_consent.record_decision(uuid,uuid,text,uuid,uuid,uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.get_academy_consent_context(uuid,uuid),
  public.record_academy_consent(uuid,uuid,uuid,uuid,uuid,text,jsonb),
  public.withdraw_academy_consent(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_academy_consent_context(uuid,uuid),
  public.record_academy_consent(uuid,uuid,uuid,uuid,uuid,text,jsonb),
  public.withdraw_academy_consent(uuid,uuid,uuid,uuid) TO authenticated;
COMMIT;

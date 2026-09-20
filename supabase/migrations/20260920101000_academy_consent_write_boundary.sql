-- DRAFT P2 cutover boundary. Requires authority 20260919202324. Reader/UI/AI,
-- legacy-history adoption and erasure integration must be reviewed before release.
BEGIN;
CREATE TABLE trak_consent.maintenance (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  actor uuid NOT NULL,
  PRIMARY KEY (backend_pid, transaction_id, actor)
);
CREATE TABLE trak_consent.authorization_receipts (
  id uuid PRIMARY KEY,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE')),
  player_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('coaching_records','recognition')),
  player_age integer NOT NULL CHECK (player_age >= 0),
  basis text NOT NULL CHECK (basis IN ('guardian','adult_no_guardian_required')),
  scope_revision bigint NOT NULL,
  guardian_event_ids uuid[] NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((basis='guardian' AND player_age<18 AND cardinality(guardian_event_ids)>0)
    OR (basis='adult_no_guardian_required' AND player_age>=18 AND purpose='coaching_records' AND cardinality(guardian_event_ids)=0))
);
ALTER TABLE trak_consent.maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE trak_consent.authorization_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trak_consent.maintenance, trak_consent.authorization_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_authorization_receipt BEFORE UPDATE OR DELETE ON trak_consent.authorization_receipts
FOR EACH ROW EXECUTE FUNCTION trak_consent.immutable_evidence();

CREATE FUNCTION trak_consent.is_maintenance() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
  SELECT (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin')
      AND current_setting('role') IN ('none','postgres','supabase_admin'))
    OR EXISTS(SELECT 1 FROM trak_consent.maintenance m WHERE m.backend_pid=pg_backend_pid()
      AND m.transaction_id=txid_current() AND m.actor=auth.uid());
$fn$;

-- Public RPC retains its signature. Only this checked deletion path can enter
-- the private maintenance scope, so withdrawal never prevents account erasure.
ALTER FUNCTION public.delete_my_account() SET SCHEMA trak_consent;
ALTER FUNCTION trak_consent.delete_my_account() RENAME TO delete_my_account_legacy;
REVOKE ALL ON FUNCTION trak_consent.delete_my_account_legacy() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION trak_consent.delete_account() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated account required' USING ERRCODE='42501'; END IF;
  INSERT INTO trak_consent.maintenance VALUES(pg_backend_pid(),txid_current(),v_actor);
  PERFORM trak_consent.delete_my_account_legacy();
  DELETE FROM trak_consent.maintenance m WHERE m.backend_pid=pg_backend_pid() AND m.transaction_id=txid_current() AND m.actor=v_actor;
END;
$fn$;
CREATE FUNCTION public.delete_my_account() RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT trak_consent.delete_account();
$fn$;

DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['matches','coach_assessments','coach_assessment_notes','recognition_awards','session_attendance','meeting_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN consent_child_id uuid, ADD COLUMN consent_organization_id uuid, ADD COLUMN consent_authorization_id uuid, ADD COLUMN consent_recorded_at timestamptz',table_name);
  END LOOP;
END;
$migration$;
-- Existing rows do not acquire a fictional approval receipt. Only unambiguous
-- existing assessment/award academy snapshots are retained here. Other legacy
-- provenance, including matches, remains unresolved until the history cutover.
UPDATE public.coach_assessments a SET consent_child_id=s.linked_player_id, consent_organization_id=a.organization_id
FROM public.squad_players s WHERE s.id=a.squad_player_id AND a.organization_id IS NOT NULL;
UPDATE public.recognition_awards a SET consent_child_id=s.linked_player_id, consent_organization_id=a.organization_id
FROM public.squad_players s WHERE s.id=a.squad_player_id AND a.organization_id IS NOT NULL;
UPDATE public.coach_assessment_notes n SET consent_child_id=a.consent_child_id, consent_organization_id=a.consent_organization_id
FROM public.coach_assessments a WHERE a.id=n.assessment_id;

CREATE FUNCTION trak_consent.authorize_write(p_child uuid,p_org uuid,p_purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $fn$
DECLARE dob date; player_age integer; revision bigint; notice uuid; events uuid[]; enabled boolean;
BEGIN
  IF auth.uid() IS NULL OR p_child IS NULL OR p_org IS NULL OR p_purpose IS NULL OR p_purpose NOT IN ('coaching_records','recognition') THEN
    RAISE EXCEPTION 'Verified child and academy required' USING ERRCODE='42501';
  END IF;
  INSERT INTO trak_consent.scopes(player_user_id,organization_id) VALUES(p_child,p_org) ON CONFLICT DO NOTHING;
  SELECT s.revision INTO revision FROM trak_consent.scopes s WHERE s.player_user_id=p_child AND s.organization_id=p_org FOR UPDATE;
  SELECT pd.date_of_birth INTO dob FROM public.player_details pd JOIN public.profiles p ON p.user_id=pd.user_id
    WHERE pd.user_id=p_child AND p.role='player' FOR SHARE OF pd,p;
  IF dob IS NULL OR dob>(statement_timestamp() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'A valid player date of birth is required' USING ERRCODE='42501';
  END IF;
  player_age := date_part('year',age((statement_timestamp() AT TIME ZONE 'UTC')::date,dob))::integer;
  IF player_age>=18 THEN
    IF p_purpose<>'coaching_records' THEN
      RAISE EXCEPTION 'Adult optional-purpose approval is not configured' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('age',player_age,'revision',revision,'events','[]'::jsonb,'basis','adult_no_guardian_required');
  END IF;
  SELECT pr.notice_id,pr.enabled INTO notice,enabled FROM trak_consent.programs pr JOIN public.organizations o ON o.id=pr.organization_id
    WHERE pr.organization_id=p_org FOR SHARE OF pr,o;
  IF NOT coalesce(enabled,false) THEN RAISE EXCEPTION 'Academy consent is not enabled' USING ERRCODE='42501'; END IF;
  -- The scope lock serializes with decisions; shared locks also serialize with
  -- guardian unlink/deletion/unverification. Recheck the rows after any wait.
  SELECT array_agg(approved.id ORDER BY approved.id) INTO events FROM (
    SELECT e.id FROM trak_consent.decisions d JOIN trak_consent.events e ON e.id=d.event_id
    JOIN auth.users u ON u.id=d.parent_user_id AND u.email_confirmed_at IS NOT NULL AND nullif(btrim(u.email),'') IS NOT NULL
    JOIN public.profiles p ON p.user_id=u.id AND p.role='parent'
    JOIN public.player_parent_links l ON l.parent_user_id=d.parent_user_id AND l.player_user_id=d.player_user_id
    WHERE d.player_user_id=p_child AND d.organization_id=p_org AND e.action='grant'
      AND e.notice_id=notice AND e.purposes->p_purpose='true'::jsonb
    FOR SHARE OF u,p,l
  ) approved;
  IF coalesce(cardinality(events),0)=0 THEN RAISE EXCEPTION 'Current academy guardian approval is required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('age',player_age,'revision',revision,'events',to_jsonb(events),'basis','guardian');
END;
$fn$;

-- Existing coach RLS must consult the same academy authority as the trigger.
-- Otherwise a valid academy grant for a younger child would still be rejected
-- by the obsolete child-wide consent predicate.
CREATE OR REPLACE FUNCTION public.squad_player_consent_required(p_squad_player_id uuid)
-- VOLATILE is required: a write may have waited for a concurrent grant.
-- Reusing the outer INSERT snapshot would reject the just-committed approval.
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $fn$
  SELECT coalesce((SELECT CASE
    WHEN pd.date_of_birth IS NULL OR pd.date_of_birth>(statement_timestamp() AT TIME ZONE 'UTC')::date THEN true
    WHEN date_part('year',age((statement_timestamp() AT TIME ZONE 'UTC')::date,pd.date_of_birth))>=18 THEN false
    ELSE NOT trak_consent.has_guardian_approval(s.linked_player_id,s.organization_id,'coaching_records') END
    FROM public.squad_players s LEFT JOIN public.player_details pd ON pd.user_id=s.linked_player_id
    WHERE s.id=p_squad_player_id),true);
$fn$;

CREATE FUNCTION trak_consent.guard_development_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE child uuid; org uuid; roster public.squad_players; assessment public.coach_assessments;
  role_name text; actor uuid := auth.uid(); coach_org uuid; requested_org uuid; candidate_orgs uuid[];
  session_coach uuid;
BEGIN
  IF trak_consent.is_maintenance() THEN RETURN NEW; END IF;
  SELECT p.role::text INTO role_name FROM public.profiles p WHERE p.user_id=actor FOR SHARE;
  IF actor IS NULL OR role_name IS NULL THEN RAISE EXCEPTION 'Authenticated profile required' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='matches' THEN
    child:=NEW.user_id;
    requested_org:=NEW.consent_organization_id;
    IF role_name='coach' THEN
      SELECT cd.organization_id INTO org FROM public.coach_details cd WHERE cd.user_id=actor FOR SHARE;
      IF requested_org IS NOT NULL AND requested_org IS DISTINCT FROM org THEN
        RAISE EXCEPTION 'Match academy does not match the coach' USING ERRCODE='42501';
      END IF;
    ELSIF role_name='player' AND actor=child THEN
      IF requested_org IS NULL THEN
        SELECT array_agg(DISTINCT s.organization_id) INTO candidate_orgs FROM public.squad_players s
          JOIN public.coach_details cd ON cd.user_id=s.coach_user_id AND cd.organization_id=s.organization_id
          WHERE s.linked_player_id=child AND s.status='active' AND s.organization_id IS NOT NULL;
        IF coalesce(cardinality(candidate_orgs),0)<>1 THEN
          RAISE EXCEPTION 'Choose the academy for this match' USING ERRCODE='42501';
        END IF;
        org:=candidate_orgs[1];
      ELSE org:=requested_org; END IF;
    ELSE RAISE EXCEPTION 'Match actor is not permitted' USING ERRCODE='42501'; END IF;
    SELECT s.* INTO roster FROM public.squad_players s JOIN public.coach_details cd
      ON cd.user_id=s.coach_user_id AND cd.organization_id=s.organization_id
      WHERE s.linked_player_id=child AND s.organization_id=org AND s.status='active'
        AND (role_name='player' OR s.coach_user_id=actor) ORDER BY s.id LIMIT 1 FOR SHARE OF s,cd;
    IF roster.id IS NULL THEN RAISE EXCEPTION 'Active academy membership required' USING ERRCODE='42501'; END IF;
  ELSE
    IF TG_TABLE_NAME='coach_assessment_notes' THEN
      SELECT a.* INTO assessment FROM public.coach_assessments a WHERE a.id=NEW.assessment_id FOR SHARE;
      SELECT s.* INTO roster FROM public.squad_players s WHERE s.id=assessment.squad_player_id FOR SHARE;
      IF assessment.id IS NULL OR assessment.coach_user_id IS DISTINCT FROM actor OR NEW.coach_user_id IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'Assessment note ownership mismatch' USING ERRCODE='42501';
      END IF;
    ELSE
      SELECT s.* INTO roster FROM public.squad_players s WHERE s.id=NEW.squad_player_id FOR SHARE;
    END IF;
    child:=roster.linked_player_id; org:=roster.organization_id;
    IF role_name<>'coach' OR roster.coach_user_id IS DISTINCT FROM actor OR roster.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Active coach roster ownership required' USING ERRCODE='42501';
    END IF;
    SELECT cd.organization_id INTO coach_org FROM public.coach_details cd WHERE cd.user_id=actor FOR SHARE;
    IF org IS NULL OR org IS DISTINCT FROM coach_org THEN RAISE EXCEPTION 'Roster academy mismatch' USING ERRCODE='42501'; END IF;
    IF TG_TABLE_NAME IN ('coach_assessments','recognition_awards','meeting_requests') THEN
      IF NEW.coach_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Coach actor mismatch' USING ERRCODE='42501'; END IF;
    END IF;
    IF TG_TABLE_NAME IN ('coach_assessments','session_attendance') THEN
      IF NEW.session_id IS NOT NULL THEN
        SELECT cs.coach_user_id INTO session_coach FROM public.coach_sessions cs WHERE cs.id=NEW.session_id FOR SHARE;
        IF session_coach IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Session ownership mismatch' USING ERRCODE='42501'; END IF;
      END IF;
    END IF;
    IF TG_TABLE_NAME='coach_assessment_notes' AND (assessment.consent_child_id IS DISTINCT FROM child OR assessment.consent_organization_id IS DISTINCT FROM org) THEN
      RAISE EXCEPTION 'Assessment provenance needs review' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.consent_child_id IS NULL OR NEW.id IS DISTINCT FROM OLD.id OR OLD.consent_organization_id IS NULL
    OR OLD.consent_child_id IS DISTINCT FROM child OR OLD.consent_organization_id IS DISTINCT FROM org
    OR NEW.consent_child_id IS DISTINCT FROM OLD.consent_child_id
    OR NEW.consent_organization_id IS DISTINCT FROM OLD.consent_organization_id) THEN
    RAISE EXCEPTION 'Development record provenance cannot change' USING ERRCODE='42501';
  END IF;
  PERFORM trak_consent.authorize_write(child,org,CASE WHEN TG_TABLE_NAME='recognition_awards' THEN 'recognition' ELSE 'coaching_records' END);
  NEW.consent_child_id:=child; NEW.consent_organization_id:=org;
  NEW.consent_authorization_id:=gen_random_uuid(); NEW.consent_recorded_at:=clock_timestamp();
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION trak_consent.capture_authorization() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE proof jsonb; purpose text:=CASE WHEN TG_TABLE_NAME='recognition_awards' THEN 'recognition' ELSE 'coaching_records' END;
BEGIN
  IF trak_consent.is_maintenance() THEN RETURN NEW; END IF;
  proof:=trak_consent.authorize_write(NEW.consent_child_id,NEW.consent_organization_id,purpose);
  INSERT INTO trak_consent.authorization_receipts(id,table_name,record_id,operation,player_user_id,organization_id,actor_user_id,
    purpose,player_age,basis,scope_revision,guardian_event_ids,recorded_at)
  VALUES(NEW.consent_authorization_id,TG_TABLE_NAME,NEW.id,TG_OP,NEW.consent_child_id,NEW.consent_organization_id,auth.uid(),
    purpose,(proof->>'age')::integer,proof->>'basis',(proof->>'revision')::bigint,
    ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(proof->'events')),NEW.consent_recorded_at);
  RETURN NEW;
END;
$fn$;
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['matches','coach_assessments','coach_assessment_notes','recognition_awards','session_attendance','meeting_requests'] LOOP
    -- Run after existing actor/org stamping triggers.
    EXECUTE format('CREATE TRIGGER zz_consent_write_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION trak_consent.guard_development_write()',table_name);
    EXECUTE format('CREATE TRIGGER zz_consent_write_receipt AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION trak_consent.capture_authorization()',table_name);
  END LOOP;
END;
$migration$;
CREATE FUNCTION trak_consent.protect_date_of_birth() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
  IF NOT trak_consent.is_maintenance() AND OLD.date_of_birth IS NOT NULL AND NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    RAISE EXCEPTION 'Date of birth corrections require verified support review' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER consent_dob_immutable BEFORE UPDATE ON public.player_details FOR EACH ROW EXECUTE FUNCTION trak_consent.protect_date_of_birth();
REVOKE ALL ON FUNCTION trak_consent.is_maintenance(),trak_consent.authorize_write(uuid,uuid,text),
  trak_consent.guard_development_write(),trak_consent.capture_authorization(),trak_consent.protect_date_of_birth(),
  trak_consent.delete_account(),public.delete_my_account() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION trak_consent.delete_account(),public.delete_my_account() TO authenticated;
COMMIT;

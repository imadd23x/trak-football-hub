-- Draft P2 read cutover. Restrictive policies supplement rather than replace
-- existing audience/ownership rules. PostgREST GET uses READ ONLY transactions:
-- this predicate performs no writes or row locks.
BEGIN;
CREATE FUNCTION trak_consent.may_read_development(p_child uuid,p_org uuid,p_purpose text,
  p_private boolean DEFAULT false,p_author uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $fn$
DECLARE actor uuid:=auth.uid(); role_name text; dob date; player_age integer;
BEGIN
  IF actor IS NULL OR p_child IS NULL OR p_org IS NULL OR p_purpose IS NULL
    OR p_purpose NOT IN ('coaching_records','recognition') OR p_private IS NULL THEN RETURN false; END IF;
  SELECT p.role::text INTO role_name FROM public.profiles p WHERE p.user_id=actor;
  IF role_name IS NULL THEN RETURN false; END IF;
  -- Private notes are never made public by a consent choice. A null/deleted
  -- author cannot accidentally turn a private record into a shared one.
  IF p_private AND (role_name<>'coach' OR actor IS DISTINCT FROM p_author) THEN RETURN false; END IF;
  CASE role_name
    WHEN 'player' THEN IF actor<>p_child THEN RETURN false; END IF;
    WHEN 'parent' THEN
      IF NOT EXISTS(SELECT 1 FROM public.player_parent_links l JOIN auth.users u ON u.id=l.parent_user_id
          WHERE l.parent_user_id=actor AND l.player_user_id=p_child
            AND u.email_confirmed_at IS NOT NULL AND nullif(btrim(u.email),'') IS NOT NULL) THEN RETURN false; END IF;
    WHEN 'coach' THEN
      IF NOT EXISTS(SELECT 1 FROM public.coach_details cd JOIN public.squad_players s
          ON s.coach_user_id=cd.user_id AND s.organization_id=cd.organization_id
          WHERE cd.user_id=actor AND cd.organization_id=p_org AND s.linked_player_id=p_child AND s.status='active') THEN RETURN false; END IF;
    WHEN 'club' THEN
      IF NOT EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=p_org AND o.admin_user_id=actor) THEN RETURN false; END IF;
    ELSE RETURN false;
  END CASE;
  SELECT pd.date_of_birth INTO dob FROM public.player_details pd JOIN public.profiles p ON p.user_id=pd.user_id
    WHERE pd.user_id=p_child AND p.role='player';
  IF dob IS NULL OR dob>(statement_timestamp() AT TIME ZONE 'UTC')::date THEN RETURN false; END IF;
  player_age:=date_part('year',age((statement_timestamp() AT TIME ZONE 'UTC')::date,dob))::integer;
  IF player_age>=18 THEN
    -- Guardian choices expire at 18. Adult optional choices are a remaining
    -- cutover requirement, not inferred from historic parent permission.
    RETURN role_name<>'parent' AND p_purpose='coaching_records';
  END IF;
  IF NOT trak_consent.has_guardian_approval(p_child,p_org,'coaching_records') THEN RETURN false; END IF;
  IF p_purpose='recognition' AND NOT trak_consent.has_guardian_approval(p_child,p_org,'recognition') THEN RETURN false; END IF;
  IF role_name='parent' AND NOT trak_consent.has_guardian_approval(p_child,p_org,'parent_visibility') THEN RETURN false; END IF;
  RETURN true;
END;
$fn$;
-- VOLATILE takes fresh snapshots for its internal reads after a concurrent
-- grant/withdrawal wait in an INSERT ... RETURNING. No side effects are used.
REVOKE ALL ON FUNCTION trak_consent.may_read_development(uuid,uuid,text,boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION trak_consent.may_read_development(uuid,uuid,text,boolean,uuid) TO authenticated;
DO $migration$
DECLARE table_name text; purpose text; extra text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['matches','coach_assessments','coach_assessment_notes','recognition_awards','session_attendance','meeting_requests'] LOOP
    purpose:=CASE WHEN table_name='recognition_awards' THEN 'recognition' ELSE 'coaching_records' END;
    extra:=CASE WHEN table_name='coach_assessment_notes' THEN ',true,coach_user_id' ELSE '' END;
    EXECUTE format('CREATE POLICY "Academy consent restricts development reads" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (trak_consent.may_read_development(consent_child_id,consent_organization_id,%L%s))',table_name,purpose,extra);
  END LOOP;
END;
$migration$;
COMMIT;

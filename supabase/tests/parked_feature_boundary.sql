-- @trak-suite mode=--parked-feature-boundary in-all=true
-- TRAK-47: parked authoring is closed at the database boundary. Every attempt
-- uses valid synthetic identities/rows; only 42501 or zero affected rows count
-- as denial. Trusted readbacks prevent an invisible/missing row from passing.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing parked-feature fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.p47id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('97470000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE p47_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON p47_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.p47actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role',current_user,'sub',pg_temp.p47id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.p47check(ok boolean,label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.p47_results VALUES(label,ok IS TRUE,NULL)
$$;
CREATE FUNCTION pg_temp.p47probe(statement text, label text, expected_rows bigint,
 expected_state text DEFAULT NULL, expected_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS n = ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.p47_results VALUES(label,
  CASE WHEN expected_state IS NULL THEN st IS NULL AND n = expected_rows
   ELSE st = expected_state AND (expected_message IS NULL OR msg = expected_message) END,
  coalesce(st||': '||msg,'affected rows='||n));
END $$;
CREATE FUNCTION pg_temp.p47denied(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS n = ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.p47_results VALUES(label,
  coalesce(st = '42501',st IS NULL AND n = 0),
  coalesce(st||': '||msg,'affected rows='||n));
END $$;
-- Like p47denied, but the write never survives, even if it is wrongly
-- allowed, so later fixtures and checks are not disturbed.
CREATE FUNCTION pg_temp.p47denied_rb(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE EXCEPTION USING ERRCODE = 'P9047', MESSAGE = 'roll back the probe';
 EXCEPTION
  WHEN SQLSTATE 'P9047' THEN NULL;
  WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.p47_results VALUES(label,
  coalesce(st = '42501',st IS NULL AND n = 0),
  coalesce(st||': '||msg,'affected rows='||n));
END $$;
CREATE FUNCTION pg_temp.p47compliance(label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.p47denied_rb(format('INSERT INTO public.staff_compliance(organization_id,coach_user_id,dbs_status) VALUES(%L,%L,%L)',pg_temp.p47id(100),pg_temp.p47id(10),'valid'),label||': compliance INSERT');
 PERFORM pg_temp.p47denied_rb(format('UPDATE public.staff_compliance SET dbs_status=%L WHERE organization_id=%L AND coach_user_id=%L','expired',pg_temp.p47id(100),pg_temp.p47id(13)),label||': compliance UPDATE');
 PERFORM pg_temp.p47denied_rb(format('DELETE FROM public.staff_compliance WHERE organization_id=%L AND coach_user_id=%L',pg_temp.p47id(100),pg_temp.p47id(13)),label||': compliance DELETE');
END $$;
CREATE FUNCTION pg_temp.p47writes(label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.p47denied(format('INSERT INTO public.coach_calendar_events(coach_user_id,title,starts_at) VALUES(%L,%L,%L)',pg_temp.p47id(10),'Blocked event','2026-10-02'),label||': calendar INSERT');
 PERFORM pg_temp.p47denied(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','Blocked edit',pg_temp.p47id(500)),label||': calendar UPDATE');
 PERFORM pg_temp.p47denied(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.p47id(502)),label||': calendar DELETE');
 PERFORM pg_temp.p47denied(format('INSERT INTO public.recognition_awards(coach_user_id,squad_player_id,award_type) VALUES(%L,%L,%L)',pg_temp.p47id(10),pg_temp.p47id(200),'player_of_week'),label||': award INSERT');
 PERFORM pg_temp.p47denied(format('UPDATE public.recognition_awards SET note=%L WHERE id=%L','Blocked edit',pg_temp.p47id(600)),label||': award UPDATE');
 PERFORM pg_temp.p47denied(format('DELETE FROM public.recognition_awards WHERE id=%L',pg_temp.p47id(600)),label||': award DELETE');
END $$;
CREATE FUNCTION pg_temp.p47unchanged(label text) RETURNS void LANGUAGE sql AS $$
 SELECT pg_temp.p47check(
  (SELECT count(*)=3 FROM public.coach_calendar_events WHERE coach_user_id IN (pg_temp.p47id(10),pg_temp.p47id(11)))
  AND (SELECT title='Retained own event' FROM public.coach_calendar_events WHERE id=pg_temp.p47id(500))
  AND EXISTS(SELECT 1 FROM public.coach_calendar_events WHERE id=pg_temp.p47id(502))
  AND (SELECT title='Foreign event' FROM public.coach_calendar_events WHERE id=pg_temp.p47id(510)),label||': calendar history unchanged');
 SELECT pg_temp.p47check(
  (SELECT count(*)=3 FROM public.recognition_awards WHERE coach_user_id IN (pg_temp.p47id(10),pg_temp.p47id(11),pg_temp.p47id(13)))
  AND (SELECT note='Retained own award' FROM public.recognition_awards WHERE id=pg_temp.p47id(600))
  AND (SELECT note='Foreign award' FROM public.recognition_awards WHERE id=pg_temp.p47id(610))
  AND (SELECT note='Colleague award' FROM public.recognition_awards WHERE id=pg_temp.p47id(611)),label||': award history unchanged');
$$;

-- Full role, organization, roster, player DOB and parent-link fixtures.
-- Adult players make consent explicitly unnecessary; the underage row below
-- separately verifies that an unconsented child still rejects award insertion.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.p47id(n),'synthetic-'||n||'@parked47.invalid',now()
 FROM unnest(ARRAY[1,2,3,10,11,12,13,20,21,22,23,24,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.p47id(1),'club','Admin A'),(pg_temp.p47id(2),'club','Admin B'),
 (pg_temp.p47id(10),'coach','Coach A'),(pg_temp.p47id(11),'coach','Coach B'),
 (pg_temp.p47id(12),'coach','Removal Target'),(pg_temp.p47id(13),'coach','Colleague A'),
 (pg_temp.p47id(20),'player','Player A'),(pg_temp.p47id(22),'player','Player B'),
 (pg_temp.p47id(23),'player','Colleague Player'),(pg_temp.p47id(24),'player','Minor No Consent'),
 (pg_temp.p47id(30),'parent','Parent A');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.p47id(100),pg_temp.p47id(1),'Parked Audit A','P47AA1'),
 (pg_temp.p47id(101),pg_temp.p47id(2),'Parked Audit B','P47BB1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.p47id(10),pg_temp.p47id(100)),(pg_temp.p47id(11),pg_temp.p47id(101)),
 (pg_temp.p47id(12),pg_temp.p47id(100)),(pg_temp.p47id(13),pg_temp.p47id(100));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.p47id(20),'2000-01-01'),(pg_temp.p47id(22),'2000-01-01'),
 (pg_temp.p47id(23),'2000-01-01'),(pg_temp.p47id(24),'2020-01-01');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES(pg_temp.p47id(20),pg_temp.p47id(30));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,status) VALUES
 (pg_temp.p47id(200),pg_temp.p47id(10),'Player A',pg_temp.p47id(20),'active'),
 (pg_temp.p47id(201),pg_temp.p47id(13),'Colleague Player',pg_temp.p47id(23),'active'),
 (pg_temp.p47id(202),pg_temp.p47id(12),'Removal Active',NULL,'active'),
 (pg_temp.p47id(203),pg_temp.p47id(12),'Removal Archived',NULL,'archived'),
 (pg_temp.p47id(204),pg_temp.p47id(10),'Minor No Consent',pg_temp.p47id(24),'active'),
 (pg_temp.p47id(205),pg_temp.p47id(11),'Player B',pg_temp.p47id(22),'active');
-- TRAK-48 slice 3 (#144): a new player profile needs a roster place, so the
-- provisioning control below (actor 21) is admitted the way the pilot admits.
INSERT INTO public.squad_players(id,coach_user_id,player_name,status) VALUES
 (pg_temp.p47id(206),pg_temp.p47id(10),'New Audit Player','active');
INSERT INTO public.roster_children(organization_id,squad_player_id,date_of_birth,child_email,loaded_by) VALUES
 (pg_temp.p47id(100),pg_temp.p47id(206),'2000-01-01','synthetic-21@parked47.invalid','fixture');
INSERT INTO public.staff_compliance(organization_id,coach_user_id,dbs_status) VALUES
 (pg_temp.p47id(100),pg_temp.p47id(12),'valid'),
 (pg_temp.p47id(101),pg_temp.p47id(11),'valid');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at,published) VALUES
 (pg_temp.p47id(500),pg_temp.p47id(10),'Retained own event','2026-10-01',true),
 (pg_temp.p47id(502),pg_temp.p47id(10),'Own deletable event','2026-10-01',false),
 (pg_temp.p47id(510),pg_temp.p47id(11),'Foreign event','2026-10-01',true);
INSERT INTO public.recognition_awards(id,coach_user_id,squad_player_id,award_type,note) VALUES
 (pg_temp.p47id(600),pg_temp.p47id(10),pg_temp.p47id(200),'player_of_week','Retained own award'),
 (pg_temp.p47id(610),pg_temp.p47id(11),pg_temp.p47id(205),'player_of_week','Foreign award'),
 (pg_temp.p47id(611),pg_temp.p47id(13),pg_temp.p47id(201),'player_of_week','Colleague award');

-- Both explicit and PUBLIC-inherited capabilities must be absent.
DO $$ DECLARE t text; r text; op text; BEGIN
 FOREACH t IN ARRAY ARRAY['coach_calendar_events','recognition_awards'] LOOP
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   FOREACH op IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    PERFORM pg_temp.p47check(NOT has_table_privilege(r,'public.'||t,op),r||' has no '||op||' on '||t);
   END LOOP;
  END LOOP;
  PERFORM pg_temp.p47check(NOT EXISTS(SELECT 1 FROM pg_class c,
   LATERAL aclexplode(c.relacl) a WHERE c.oid=('public.'||t)::regclass
   AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE')),t||' has no PUBLIC writes');
  PERFORM pg_temp.p47check(has_table_privilege('authenticated','public.'||t,'SELECT'),t||' retains application SELECT');
  FOREACH op IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
   PERFORM pg_temp.p47check(has_table_privilege('service_role','public.'||t,op),t||' retains service '||op);
  END LOOP;
  -- Grant re-derivation must find no enabling write policies.
  PERFORM pg_temp.p47check(NOT EXISTS(SELECT 1 FROM pg_policies p
   WHERE p.schemaname='public' AND p.tablename=t AND p.cmd IN ('ALL','INSERT','UPDATE','DELETE')
   AND p.roles && ARRAY['authenticated','public']::name[]
   AND coalesce(p.qual,'true') NOT IN ('false','(false)')
   AND coalesce(p.with_check,'true') NOT IN ('false','(false)')),t||' policy-derived grants remain read-only');
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  PERFORM pg_temp.p47check(NOT has_function_privilege(r,'public.remove_coach_from_org(uuid)','EXECUTE'),r||' cannot execute removal RPC');
 END LOOP;
 PERFORM pg_temp.p47check(NOT EXISTS(SELECT 1 FROM pg_proc p,
  LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.remove_coach_from_org(uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'PUBLIC cannot execute removal RPC');
 PERFORM pg_temp.p47check(has_function_privilege('service_role','public.remove_coach_from_org(uuid)','EXECUTE'),'service can execute removal RPC');
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.p47actor(10);
SELECT pg_temp.p47check(current_user='authenticated' AND auth.uid()=pg_temp.p47id(10) AND public.is_coach(),'Valid coach identity');
SELECT pg_temp.p47check(public.squad_player_is_mine(pg_temp.p47id(200)) AND NOT public.coach_squad_player_consent_required(pg_temp.p47id(200)),'Owned adult roster is authorized and needs no parental consent');
SELECT pg_temp.p47writes('Owning coach');
-- Foreign academy and same-academy colleague controls use valid target rows.
SELECT pg_temp.p47denied(format('INSERT INTO public.coach_calendar_events(coach_user_id,title,starts_at) VALUES(%L,%L,%L)',pg_temp.p47id(11),'Spoofed event','2026-10-02'),'Schedule foreign-owner INSERT denied');
SELECT pg_temp.p47denied(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','Bad foreign edit',pg_temp.p47id(510)),'Schedule foreign UPDATE denied');
SELECT pg_temp.p47denied(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.p47id(510)),'Schedule foreign DELETE denied');
SELECT pg_temp.p47denied(format('INSERT INTO public.recognition_awards(coach_user_id,squad_player_id,award_type) VALUES(%L,%L,%L)',pg_temp.p47id(10),pg_temp.p47id(205),'player_of_week'),'Recognition foreign-roster INSERT denied');
SELECT pg_temp.p47denied(format('INSERT INTO public.recognition_awards(coach_user_id,squad_player_id,award_type) VALUES(%L,%L,%L)',pg_temp.p47id(10),pg_temp.p47id(201),'player_of_week'),'Recognition same-org colleague INSERT denied');
SELECT pg_temp.p47denied(format('INSERT INTO public.recognition_awards(coach_user_id,squad_player_id,award_type) VALUES(%L,%L,%L)',pg_temp.p47id(10),pg_temp.p47id(204),'player_of_week'),'Recognition unconsented-minor INSERT denied');
SELECT pg_temp.p47denied(format('UPDATE public.recognition_awards SET note=%L WHERE id IN (%L,%L)','Bad foreign edit',pg_temp.p47id(610),pg_temp.p47id(611)),'Recognition foreign and colleague UPDATE denied');
SELECT pg_temp.p47denied(format('DELETE FROM public.recognition_awards WHERE id=%L',pg_temp.p47id(610)),'Recognition foreign DELETE denied');
SELECT pg_temp.p47denied(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Removal RPC non-admin denied');

-- P0 controls: these methods are shared with retained J4/J5 and account rights.
SELECT pg_temp.p47probe(format('INSERT INTO public.coach_sessions(id,coach_user_id,title) VALUES(%L,%L,%L)',pg_temp.p47id(700),pg_temp.p47id(10),'Retained J4 session'),'J4 session INSERT allowed',1);
SELECT pg_temp.p47probe(format('INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id,session_id) VALUES(%L,%L,%L,%L)',pg_temp.p47id(701),pg_temp.p47id(10),pg_temp.p47id(200),pg_temp.p47id(700)),'J5 assessment INSERT allowed',1);
SELECT pg_temp.p47probe(format('UPDATE public.coach_assessments SET work_rate=7 WHERE id=%L',pg_temp.p47id(701)),'J5 assessment UPDATE allowed',1);
SELECT pg_temp.p47probe(format('INSERT INTO public.coach_assessment_notes(assessment_id,coach_user_id,note) VALUES(%L,%L,%L)',pg_temp.p47id(701),pg_temp.p47id(10),'Private J5 note'),'J5 private note INSERT allowed',1);
SELECT pg_temp.p47probe(format('UPDATE public.coach_assessment_notes SET note=%L WHERE assessment_id=%L','Edited J5 note',pg_temp.p47id(701)),'J5 private note UPDATE allowed',1);
SELECT pg_temp.p47probe(format('SELECT public.log_match_for_player(%L,''Audit opponent'',1,0,''League'',''Home'',''Midfielder'',''U17'',90,0,0,NULL,NULL,NULL,7.0,CURRENT_DATE)',pg_temp.p47id(20)),'J4 log_match_for_player RPC allowed',1);
SELECT pg_temp.p47probe(format('UPDATE public.profiles SET full_name=%L WHERE user_id=%L','Edited Coach A',pg_temp.p47id(10)),'Profile non-photo UPDATE allowed',1);
SELECT pg_temp.p47check(public.export_my_account()->'profile'->>'full_name'='Edited Coach A','Account export allowed');
SELECT pg_temp.p47actor(21);
SELECT pg_temp.p47probe('SELECT public.provision_my_profile(''{"role":"player","full_name":"New Audit Player"}''::jsonb)','Profile provision RPC allowed',1);
SELECT pg_temp.p47probe('SELECT public.delete_my_account()','Account deletion RPC allowed',1);
-- Trak sets up staff (TRAK-12, #151): the operator creates an academy admin
-- and their academy, and no parked-feature policy may block that.
RESET ROLE;
SELECT pg_temp.p47probe(format('SELECT public.admit_staff_member(%L,''club'',''New Audit Admin'',NULL,''New Audit Academy'')',pg_temp.p47id(3)),'Club profile and organization provision allowed',1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.p47actor(3);
SELECT pg_temp.p47check((SELECT count(*) FROM public.organizations WHERE admin_user_id=pg_temp.p47id(3))=1,'Organization actually provisioned');
SELECT pg_temp.p47actor(20);
SELECT pg_temp.p47writes('Player');
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Player removal RPC denied',NULL,'42501');
SELECT pg_temp.p47check((SELECT count(*) FROM public.recognition_awards WHERE id=pg_temp.p47id(600))=1,'Player retained award read');
SELECT pg_temp.p47check((SELECT count(*) FROM public.coach_calendar_events WHERE id=pg_temp.p47id(500))=1,'Player published event read');
SELECT pg_temp.p47actor(30);
SELECT pg_temp.p47writes('Parent');
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Parent removal RPC denied',NULL,'42501');
SELECT pg_temp.p47check((SELECT count(*) FROM public.recognition_awards WHERE id=pg_temp.p47id(600))=1,'Parent retained award read');
SELECT pg_temp.p47check((SELECT count(*) FROM public.coach_calendar_events WHERE id=pg_temp.p47id(500))=1,'Parent published event read');
SELECT pg_temp.p47actor(2);
SELECT pg_temp.p47writes('Foreign club admin');
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Foreign club admin removal RPC denied',NULL,'42501');
SELECT pg_temp.p47actor(1);
SELECT pg_temp.p47writes('Own club admin');
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Own club admin removal RPC denied',NULL,'42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_temp.p47writes('Anonymous');
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Anonymous removal RPC denied',NULL,'42501');
RESET ROLE;
SELECT pg_temp.p47unchanged('Application denial readback');
SELECT pg_temp.p47check((SELECT organization_id=pg_temp.p47id(100) FROM public.coach_details WHERE user_id=pg_temp.p47id(12)),'Denied removal preserves membership');
SELECT pg_temp.p47check((SELECT status='active' FROM public.squad_players WHERE id=pg_temp.p47id(202)) AND (SELECT status='archived' FROM public.squad_players WHERE id=pg_temp.p47id(203)),'Denied removal preserves both roster statuses');
SELECT pg_temp.p47check(EXISTS(SELECT 1 FROM public.staff_compliance WHERE organization_id=pg_temp.p47id(100) AND coach_user_id=pg_temp.p47id(12)),'Denied removal preserves compliance');
SELECT pg_temp.p47check((SELECT count(*) FROM public.matches WHERE user_id=pg_temp.p47id(20) AND logged_by=pg_temp.p47id(10) AND logged_by_role='coach')=1,'J4 RPC persisted exactly one coach match');
SELECT pg_temp.p47check((SELECT title='Retained J4 session' FROM public.coach_sessions WHERE id=pg_temp.p47id(700)),'J4 session persisted');
SELECT pg_temp.p47check((SELECT work_rate=7 FROM public.coach_assessments WHERE id=pg_temp.p47id(701)),'J5 assessment persisted');
SELECT pg_temp.p47check((SELECT note='Edited J5 note' FROM public.coach_assessment_notes WHERE assessment_id=pg_temp.p47id(701)),'J5 private note persisted');
SELECT pg_temp.p47check(NOT EXISTS(SELECT 1 FROM auth.users WHERE id=pg_temp.p47id(21)),'Account deletion removed provisioned account');

-- Trusted incident cleanup still requires a valid owning admin identity.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Service without identity denied',NULL,'P0001','Not authorized — must be a club admin');
SELECT pg_temp.p47actor(10);
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Service with coach identity denied',NULL,'P0001','Not authorized — must be a club admin');
SELECT pg_temp.p47actor(2);
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Service foreign admin denied',NULL,'P0001','Coach does not belong to your organization');
SELECT pg_temp.p47check((SELECT organization_id=pg_temp.p47id(100) FROM public.coach_details WHERE user_id=pg_temp.p47id(12)),'Service denials leave membership intact');
SELECT pg_temp.p47check((SELECT count(*)=2 FROM public.squad_players WHERE id IN(pg_temp.p47id(202),pg_temp.p47id(203)) AND status IN ('active','archived')),'Service denials leave roster intact');
SELECT pg_temp.p47check(EXISTS(SELECT 1 FROM public.staff_compliance WHERE organization_id=pg_temp.p47id(100) AND coach_user_id=pg_temp.p47id(12)),'Service denials leave compliance intact');
SELECT pg_temp.p47actor(1);
SELECT pg_temp.p47probe(format('SELECT public.remove_coach_from_org(%L)',pg_temp.p47id(12)),'Service owning admin removal succeeds',1);
SELECT pg_temp.p47check((SELECT organization_id IS NULL FROM public.coach_details WHERE user_id=pg_temp.p47id(12)),'Service removal clears target membership');
SELECT pg_temp.p47check((SELECT count(*)=2 FROM public.squad_players WHERE id IN(pg_temp.p47id(202),pg_temp.p47id(203)) AND status='coach_departed'),'Service removal changes both active and archived rosters');
SELECT pg_temp.p47check(NOT EXISTS(SELECT 1 FROM public.staff_compliance WHERE organization_id=pg_temp.p47id(100) AND coach_user_id=pg_temp.p47id(12)),'Service removal deletes target compliance');
SELECT pg_temp.p47check((SELECT count(*)=3 FROM public.coach_details WHERE user_id IN(pg_temp.p47id(10),pg_temp.p47id(11),pg_temp.p47id(13)) AND organization_id IS NOT NULL),'Service removal preserves other memberships');
SELECT pg_temp.p47check((SELECT count(*)=4 FROM public.squad_players WHERE id IN(pg_temp.p47id(200),pg_temp.p47id(201),pg_temp.p47id(204),pg_temp.p47id(205)) AND status='active'),'Service removal preserves other rosters');
SELECT pg_temp.p47check(EXISTS(SELECT 1 FROM public.staff_compliance WHERE organization_id=pg_temp.p47id(101) AND coach_user_id=pg_temp.p47id(11)),'Service removal preserves foreign compliance');
-- Real service DML, not only catalog grants, is the maintenance control.
SELECT pg_temp.p47probe(format('INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at) VALUES(%L,%L,%L,%L)',pg_temp.p47id(550),pg_temp.p47id(10),'Service event','2026-10-02'),'Service event insert',1);
SELECT pg_temp.p47probe(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','Service edit',pg_temp.p47id(550)),'Service event update',1);
SELECT pg_temp.p47check((SELECT title='Service edit' FROM public.coach_calendar_events WHERE id=pg_temp.p47id(550)),'Service event edit persisted');
SELECT pg_temp.p47probe(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.p47id(550)),'Service event delete',1);
SELECT pg_temp.p47probe(format('INSERT INTO public.recognition_awards(id,coach_user_id,squad_player_id,award_type) VALUES(%L,%L,%L,%L)',pg_temp.p47id(650),pg_temp.p47id(10),pg_temp.p47id(200),'effort'),'Service award insert',1);
SELECT pg_temp.p47probe(format('UPDATE public.recognition_awards SET note=%L WHERE id=%L','Service edit',pg_temp.p47id(650)),'Service award update',1);
SELECT pg_temp.p47check((SELECT note='Service edit' FROM public.recognition_awards WHERE id=pg_temp.p47id(650)),'Service award edit persisted');
SELECT pg_temp.p47probe(format('DELETE FROM public.recognition_awards WHERE id=%L',pg_temp.p47id(650)),'Service award delete',1);
RESET ROLE;
SELECT pg_temp.p47unchanged('Trusted operation readback');

-- The academy console is Coming soon (TRAK-43), so its compliance (DBS)
-- records are read-only for app roles too (TRAK-47 follow-up, 26 Sep).
-- The earlier removal deleted coach 12's row, so the probes aim at coach 13's
-- (written here by the operator); a probe that matches nothing proves nothing.
INSERT INTO public.staff_compliance(organization_id,coach_user_id,dbs_status) VALUES(pg_temp.p47id(100),pg_temp.p47id(13),'valid');
SET LOCAL ROLE authenticated;
SELECT pg_temp.p47actor(1);
SELECT pg_temp.p47compliance('Own academy admin');
SELECT pg_temp.p47check(EXISTS(SELECT 1 FROM public.staff_compliance WHERE organization_id=pg_temp.p47id(100) AND coach_user_id=pg_temp.p47id(13)),'Own academy admin still reads compliance');
RESET ROLE;

-- Defense in depth: accidental broad grants AND overlapping permissive
-- policies must not reopen the parked writers. Changes roll back with suite.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.coach_calendar_events,public.recognition_awards,public.staff_compliance TO PUBLIC,anon,authenticated;
CREATE POLICY p47_test_overlapping_allow ON public.staff_compliance FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
CREATE POLICY p47_test_overlapping_allow ON public.coach_calendar_events FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
CREATE POLICY p47_test_overlapping_allow ON public.recognition_awards FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.p47actor(10);
SELECT pg_temp.p47writes('Restored grants and overlapping policy: Coach');
SELECT pg_temp.p47actor(20);
SELECT pg_temp.p47writes('Restored grants and overlapping policy: Player');
SELECT pg_temp.p47actor(1);
SELECT pg_temp.p47writes('Restored grants and overlapping policy: Club admin');
SELECT pg_temp.p47compliance('Restored grants and overlapping policy: Club admin');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_temp.p47writes('Restored grants and overlapping policy: anonymous');
RESET ROLE;
SELECT pg_temp.p47unchanged('Restrictive policy readback');
DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.p47_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.p47_results;
 IF failures IS NOT NULL THEN
  RAISE EXCEPTION USING MESSAGE='Parked-feature boundary failed',DETAIL=failures;
 END IF;
 RAISE NOTICE 'Parked-feature boundary: % checks passed',n;
END $$;
SELECT count(*) AS parked_feature_checks_passed FROM pg_temp.p47_results;
ROLLBACK;

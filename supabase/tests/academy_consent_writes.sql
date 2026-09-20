-- @trak-suite mode=--academy-consent-writes-review in-all=true
-- Synthetic role-level development-write boundary, using the foundation fixture.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_setting('trak.test_database',true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Disposable database required';
  END IF;
END $$;
CREATE FUNCTION pg_temp.ac_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('96000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
$$;
CREATE TEMP TABLE ac_results(description text,passed boolean,detail text);
GRANT INSERT ON ac_results TO anon,authenticated,service_role;
CREATE FUNCTION pg_temp.ac_check(ok boolean,label text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO pg_temp.ac_results VALUES(label,ok IS TRUE,NULL);
$$;
CREATE FUNCTION pg_temp.ac_error(statement text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE matched boolean:=false; detail text:='unexpected success';
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN matched:=SQLSTATE=code; detail:=SQLSTATE||': '||SQLERRM; END;
  INSERT INTO pg_temp.ac_results VALUES(label,matched,detail);
END $$;
CREATE FUNCTION pg_temp.ac_as(n int) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ac_id(n))::text,true);
END $$;
CREATE FUNCTION pg_temp.ac_reset() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
END $$;
CREATE FUNCTION pg_temp.ac_grant(child int,org int,req int,notice int,expected uuid DEFAULT NULL,
  choices jsonb DEFAULT '{"coaching_records":true,"recognition":false,"parent_visibility":false}')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_academy_consent(pg_temp.ac_id(child),pg_temp.ac_id(org),pg_temp.ac_id(req),expected,
    pg_temp.ac_id(notice),'parent',choices);
$$;
CREATE FUNCTION pg_temp.ac_context(child int,org int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.get_academy_consent_context(pg_temp.ac_id(child),pg_temp.ac_id(org));
$$;
INSERT INTO auth.users(id,email,email_confirmed_at)
SELECT pg_temp.ac_id(n),'ac-'||n||'@test.invalid',CASE WHEN n=3 THEN NULL ELSE now() END
FROM unnest(ARRAY[1,2,3,4,5,6,11,12,13,14,15]) n;
INSERT INTO public.profiles(user_id,role,full_name)
SELECT pg_temp.ac_id(n),(CASE WHEN n<5 THEN 'parent' WHEN n<11 THEN 'coach' ELSE 'player' END)::public.user_role,
  'Synthetic Consent '||n FROM unnest(ARRAY[1,2,3,4,5,6,11,12,13,14,15]) n;
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
  (pg_temp.ac_id(101),pg_temp.ac_id(5),'Synthetic Academy A','AC-A'),
  (pg_temp.ac_id(102),pg_temp.ac_id(6),'Synthetic Academy B','AC-B');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
  (pg_temp.ac_id(5),pg_temp.ac_id(101)),(pg_temp.ac_id(6),pg_temp.ac_id(102));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
  (pg_temp.ac_id(11),current_date-interval '17 years'),
  (pg_temp.ac_id(12),current_date-interval '10 years'),
  (pg_temp.ac_id(13),NULL),(pg_temp.ac_id(14),current_date-interval '18 years'),
  (pg_temp.ac_id(15),current_date+1);
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,organization_id)
SELECT pg_temp.ac_id(300+n),pg_temp.ac_id(5),'Synthetic A '||n,pg_temp.ac_id(n),pg_temp.ac_id(101)
FROM unnest(ARRAY[11,13,14,15]) n;
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,organization_id)
SELECT pg_temp.ac_id(400+n),pg_temp.ac_id(6),'Synthetic B '||n,pg_temp.ac_id(n),pg_temp.ac_id(102)
FROM unnest(ARRAY[11,12]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id)
SELECT pg_temp.ac_id(11),pg_temp.ac_id(n) FROM unnest(ARRAY[1,2,3,5]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id)
SELECT pg_temp.ac_id(n),pg_temp.ac_id(1) FROM unnest(ARRAY[12,13,14,15]) n;
INSERT INTO trak_consent.notices(id,organization_id,academy_name,controller_name,country_code,version,body,approved_at,approval_reference)
VALUES
  (pg_temp.ac_id(201),pg_temp.ac_id(101),'Synthetic A','Synthetic controller A','AE','test-v1','SYNTHETIC TEST NOTICE A',now(),'synthetic-only'),
  (pg_temp.ac_id(202),pg_temp.ac_id(102),'Synthetic B','Synthetic controller B','GR','test-v1','SYNTHETIC TEST NOTICE B',now(),'synthetic-only'),
  (pg_temp.ac_id(203),pg_temp.ac_id(101),'Synthetic A','Synthetic controller A','AE','test-v2','SYNTHETIC TEST NOTICE A2',now(),'synthetic-only');
INSERT INTO trak_consent.programs(organization_id,notice_id,enabled) VALUES
  (pg_temp.ac_id(101),pg_temp.ac_id(201),true),(pg_temp.ac_id(102),pg_temp.ac_id(202),true);

-- Keep academy administrators distinct from coaches when exercising deletion.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  (pg_temp.ac_id(16),'admin-a@test.invalid',now()),(pg_temp.ac_id(17),'admin-b@test.invalid',now());
INSERT INTO public.profiles(user_id,role,full_name) VALUES
  (pg_temp.ac_id(16),'club','Synthetic Admin A'),(pg_temp.ac_id(17),'club','Synthetic Admin B');
UPDATE public.organizations SET admin_user_id=pg_temp.ac_id(16) WHERE id=pg_temp.ac_id(101);
UPDATE public.organizations SET admin_user_id=pg_temp.ac_id(17) WHERE id=pg_temp.ac_id(102);
CREATE FUNCTION pg_temp.dc_error(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE matched boolean:=false; detail text;
BEGIN
  BEGIN EXECUTE statement; RAISE EXCEPTION 'unexpected success' USING ERRCODE='ZV001';
  EXCEPTION WHEN OTHERS THEN matched:=SQLSTATE='42501'; detail:=SQLSTATE||': '||SQLERRM; END;
  INSERT INTO pg_temp.ac_results VALUES(label,matched,detail);
END $$;
-- SELECT RLS may hide a withdrawn record before UPDATE reaches its trigger.
-- A denial therefore means zero affected rows or insufficient_privilege, never
-- an arbitrary SQL error or a successful write that happens to look unchanged.
CREATE FUNCTION pg_temp.dc_no_update(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected bigint; matched boolean:=false; detail text;
BEGIN
  BEGIN
    EXECUTE statement; GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>0 THEN RAISE EXCEPTION 'unexpected write' USING ERRCODE='ZV001'; END IF;
    matched:=true;
  EXCEPTION WHEN OTHERS THEN matched:=SQLSTATE='42501'; detail:=SQLSTATE||': '||SQLERRM; END;
  INSERT INTO pg_temp.ac_results VALUES(label,matched,detail);
END $$;
CREATE FUNCTION pg_temp.dc_assess(n int,roster int DEFAULT 311,coach int DEFAULT 5) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id) VALUES(pg_temp.ac_id(n),pg_temp.ac_id(coach),pg_temp.ac_id(roster));
$$;
INSERT INTO public.coach_sessions(id,coach_user_id,title,session_type) VALUES
  (pg_temp.ac_id(600),pg_temp.ac_id(5),'Synthetic A training','training'),
  (pg_temp.ac_id(601),pg_temp.ac_id(6),'Synthetic B training','training');
INSERT INTO public.squad_players(id,coach_user_id,player_name,organization_id)
VALUES(pg_temp.ac_id(319),pg_temp.ac_id(5),'Unlinked synthetic child',pg_temp.ac_id(101));
INSERT INTO public.parental_consents(player_user_id,parent_user_id,relationship_declared,verification_method,purposes,notice_version,consent_text,threshold_age,player_age_at_consent)
VALUES(pg_temp.ac_id(12),pg_temp.ac_id(1),'parent','email_confirmed','{"coaching_records":true}','legacy-test','SYNTHETIC LEGACY',15,10);
SELECT pg_temp.ac_as(6);
SELECT pg_temp.dc_error('SELECT pg_temp.dc_assess(706,412,6)','legacy child-wide approval alone cannot authorize a ten-year-old');
SELECT pg_temp.ac_as(5);
SELECT pg_temp.dc_error('SELECT pg_temp.dc_assess(701)','17-year-old without academy approval cannot be assessed');
SELECT pg_temp.dc_error('SELECT pg_temp.dc_assess(702,313)','unknown age cannot be assessed');
SELECT pg_temp.dc_error('SELECT pg_temp.dc_assess(703,319)','unlinked roster cannot bypass guardian approval');
SELECT pg_temp.dc_assess(704,314);
SELECT pg_temp.ac_check(EXISTS(SELECT 1 FROM public.coach_assessments WHERE id=pg_temp.ac_id(704)),'adult coaching needs no guardian approval');
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_grant(12,102,709,202);
SELECT pg_temp.ac_as(6);
SELECT pg_temp.dc_assess(705,412,6);
SELECT pg_temp.ac_check(EXISTS(SELECT 1 FROM public.coach_assessments WHERE id=pg_temp.ac_id(705)),'academy approval also admits a ten-year-old through the real RLS policy');
SELECT pg_temp.ac_as(1);
SELECT set_config('trak.dc_first',pg_temp.ac_grant(11,101,701,201)->>'event_id',true);
SELECT pg_temp.ac_as(5);
SELECT pg_temp.dc_assess(710);
SELECT pg_temp.ac_check(EXISTS(SELECT 1 FROM public.coach_assessments WHERE id=pg_temp.ac_id(710)),'valid academy coaching approval admits assessment');
SELECT pg_temp.dc_error($s$INSERT INTO public.recognition_awards(coach_user_id,squad_player_id,award_type)
 VALUES(pg_temp.ac_id(5),pg_temp.ac_id(311),'effort')$s$,'coaching-only approval does not admit recognition');
INSERT INTO public.coach_assessment_notes(id,assessment_id,coach_user_id,note)
VALUES(pg_temp.ac_id(711),pg_temp.ac_id(710),pg_temp.ac_id(5),'Synthetic private development note');
INSERT INTO public.session_attendance(id,session_id,squad_player_id) VALUES(pg_temp.ac_id(712),pg_temp.ac_id(600),pg_temp.ac_id(311));
INSERT INTO public.meeting_requests(id,coach_user_id,squad_player_id,reason) VALUES(pg_temp.ac_id(713),pg_temp.ac_id(5),pg_temp.ac_id(311),'Synthetic development meeting');
SELECT pg_temp.ac_as(6);
SELECT pg_temp.dc_error('SELECT pg_temp.dc_assess(714,411,6)','academy A approval does not admit academy B assessment');
SELECT pg_temp.ac_as(11);
SELECT pg_temp.dc_error($s$INSERT INTO public.matches(user_id,position,competition,venue,age_group)
 VALUES(pg_temp.ac_id(11),'mid','Synthetic','Test','U18')$s$,'multi-academy match cannot guess an academy');
INSERT INTO public.matches(id,user_id,position,competition,venue,age_group,consent_organization_id)
VALUES(pg_temp.ac_id(715),pg_temp.ac_id(11),'mid','Synthetic','Test','U18',pg_temp.ac_id(101));
SELECT pg_temp.dc_error($s$INSERT INTO public.matches(user_id,position,competition,venue,age_group,consent_organization_id)
 VALUES(pg_temp.ac_id(11),'mid','Synthetic','Test','U18',pg_temp.ac_id(102))$s$,'academy A grant cannot authorize a player match for B');
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_grant(11,102,710,202);
SELECT pg_temp.ac_as(11);
SELECT pg_temp.dc_error($s$UPDATE public.matches SET consent_organization_id=pg_temp.ac_id(102) WHERE id=pg_temp.ac_id(715)$s$,'match cannot be reparented to another academy');
SELECT pg_temp.dc_error($s$UPDATE public.matches SET id=pg_temp.ac_id(799) WHERE id=pg_temp.ac_id(715)$s$,'record identity cannot be reassigned away from its evidence');
SELECT pg_temp.dc_error($s$UPDATE public.player_details SET date_of_birth=current_date-interval '18 years' WHERE user_id=pg_temp.ac_id(11)$s$,'player cannot change established DOB to bypass approval');
SELECT pg_temp.ac_reset();
SELECT pg_temp.ac_check((SELECT count(*)=7 FROM trak_consent.authorization_receipts),'seven persisted records create exactly seven receipts');
SELECT pg_temp.ac_check((SELECT guardian_event_ids=ARRAY[current_setting('trak.dc_first')::uuid] FROM trak_consent.authorization_receipts WHERE record_id=pg_temp.ac_id(710)),'receipt records the exact authorizing event');
SELECT pg_temp.ac_check((SELECT player_user_id=pg_temp.ac_id(11) AND organization_id=pg_temp.ac_id(101) AND basis='guardian' FROM trak_consent.authorization_receipts WHERE record_id=pg_temp.ac_id(715)),'match receipt pins child and academy');
SELECT pg_temp.ac_as(5);
INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id) VALUES(pg_temp.ac_id(710),pg_temp.ac_id(5),pg_temp.ac_id(311)) ON CONFLICT DO NOTHING;
SELECT pg_temp.ac_reset();
SELECT pg_temp.ac_check((SELECT count(*)=7 FROM trak_consent.authorization_receipts),'conflict no-op creates no phantom receipt');
SELECT pg_temp.ac_error($s$UPDATE trak_consent.authorization_receipts SET purpose='recognition' WHERE record_id=pg_temp.ac_id(710)$s$,'55000','authorization evidence is immutable even to its owner');
SAVEPOINT failed_transaction;
SELECT pg_temp.ac_as(5);
SELECT pg_temp.dc_assess(717);
ROLLBACK TO SAVEPOINT failed_transaction;
SELECT pg_temp.ac_check(NOT EXISTS(SELECT 1 FROM public.coach_assessments WHERE id=pg_temp.ac_id(717)) AND NOT EXISTS(SELECT 1 FROM trak_consent.authorization_receipts WHERE record_id=pg_temp.ac_id(717)),'rolled-back record and receipt disappear together');
SELECT pg_temp.ac_as(2);
SELECT set_config('trak.dc_second',pg_temp.ac_grant(11,101,702,201,NULL,'{"coaching_records":true,"recognition":true,"parent_visibility":true}')->>'event_id',true);
SELECT pg_temp.ac_as(1);
SELECT public.withdraw_academy_consent(pg_temp.ac_id(11),pg_temp.ac_id(101),pg_temp.ac_id(703),current_setting('trak.dc_first')::uuid);
SELECT pg_temp.ac_as(5);
UPDATE public.coach_assessments SET work_rate=7 WHERE id=pg_temp.ac_id(710);
INSERT INTO public.recognition_awards(id,coach_user_id,squad_player_id,award_type) VALUES(pg_temp.ac_id(716),pg_temp.ac_id(5),pg_temp.ac_id(311),'effort');
SELECT pg_temp.ac_check((SELECT work_rate=7 FROM public.coach_assessments WHERE id=pg_temp.ac_id(710)),'another guardian keeps updates authorized after one withdrawal');
SELECT pg_temp.ac_as(2);
SELECT public.withdraw_academy_consent(pg_temp.ac_id(11),pg_temp.ac_id(101),pg_temp.ac_id(704),current_setting('trak.dc_second')::uuid);
SELECT pg_temp.ac_as(5);
SELECT pg_temp.dc_error('SELECT pg_temp.dc_assess(720)','last withdrawal blocks new assessments');
SELECT pg_temp.dc_no_update($s$UPDATE public.coach_assessments SET work_rate=8 WHERE id=pg_temp.ac_id(710)$s$,'last withdrawal blocks assessment updates');
SELECT pg_temp.dc_no_update($s$UPDATE public.coach_assessment_notes SET note='Changed' WHERE id=pg_temp.ac_id(711)$s$,'last withdrawal blocks private-note updates');
SELECT pg_temp.dc_no_update($s$UPDATE public.session_attendance SET minutes_played=10 WHERE id=pg_temp.ac_id(712)$s$,'last withdrawal blocks attendance updates');
SELECT pg_temp.dc_no_update($s$UPDATE public.meeting_requests SET reason='Changed' WHERE id=pg_temp.ac_id(713)$s$,'last withdrawal blocks meeting updates');
SELECT pg_temp.dc_no_update($s$UPDATE public.recognition_awards SET note='Changed' WHERE id=pg_temp.ac_id(716)$s$,'last withdrawal blocks recognition updates');
SELECT pg_temp.ac_as(11);
SELECT pg_temp.dc_no_update($s$UPDATE public.matches SET goals=1 WHERE id=pg_temp.ac_id(715)$s$,'last withdrawal blocks player match updates');
SELECT pg_temp.ac_reset();
SELECT pg_temp.ac_check((SELECT count(*)=9 FROM trak_consent.authorization_receipts),'failed updates leave no receipt');
SELECT pg_temp.ac_as(5);
SELECT pg_temp.dc_error('SELECT * FROM trak_consent.authorization_receipts','application cannot read private authorization receipts');
SELECT pg_temp.dc_error('INSERT INTO trak_consent.maintenance VALUES(pg_backend_pid(),txid_current(),auth.uid())','application cannot forge maintenance capability');
SELECT pg_temp.dc_error('SELECT trak_consent.delete_my_account_legacy()','application cannot bypass checked deletion wrapper');
SELECT public.delete_my_account();
SELECT pg_temp.ac_reset();
SELECT pg_temp.ac_check(NOT EXISTS(SELECT 1 FROM auth.users WHERE id=pg_temp.ac_id(5)),'coach account deletion succeeds after withdrawal');
SELECT pg_temp.ac_check((SELECT coach_user_id IS NULL AND consent_organization_id=pg_temp.ac_id(101) FROM public.coach_assessments WHERE id=pg_temp.ac_id(710)),'deletion keeps academy provenance with retained history');
SELECT pg_temp.ac_check(NOT EXISTS(SELECT 1 FROM trak_consent.maintenance),'deletion removes its private maintenance capability');
SELECT pg_temp.ac_check((SELECT count(*)=9 FROM trak_consent.authorization_receipts),'deletion preserves authorization evidence without fabricating another receipt');
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(description||coalesce(' ['||detail||']',''),E'\n') INTO failures FROM ac_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Academy consent write assertions failed' USING DETAIL=failures; END IF;
END $$;
SELECT count(*) AS academy_consent_write_assertions FROM ac_results;
ROLLBACK;

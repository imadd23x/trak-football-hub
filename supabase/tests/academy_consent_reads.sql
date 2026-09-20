-- @trak-suite mode=--academy-consent-reads-review in-all=true
-- Synthetic role-level development-read boundary, using the foundation fixture.
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
CREATE FUNCTION pg_temp.dr_visible(table_name text,record_number integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE visible boolean;
BEGIN
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1)',table_name) INTO visible USING pg_temp.ac_id(record_number);
  RETURN visible;
END $$;
-- Deliberately unresolved legacy provenance must remain hidden even after a
-- current approval. This is not an invented retrospective authorization.
INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id) VALUES(pg_temp.ac_id(899),pg_temp.ac_id(5),pg_temp.ac_id(311));
INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id,consent_child_id,consent_organization_id) VALUES
 (pg_temp.ac_id(813),pg_temp.ac_id(5),pg_temp.ac_id(313),pg_temp.ac_id(13),pg_temp.ac_id(101)),
 (pg_temp.ac_id(815),pg_temp.ac_id(5),pg_temp.ac_id(315),pg_temp.ac_id(15),pg_temp.ac_id(101));
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_grant(11,102,850,202,NULL,'{"coaching_records":true,"recognition":true,"parent_visibility":true}');
SELECT pg_temp.ac_as(6);
INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id) VALUES(pg_temp.ac_id(880),pg_temp.ac_id(6),pg_temp.ac_id(411));
SELECT pg_temp.ac_as(1);
SELECT set_config('trak.dr_first',pg_temp.ac_grant(11,101,801,201,NULL,
 '{"coaching_records":true,"recognition":true,"parent_visibility":true}')->>'event_id',true);
SELECT pg_temp.ac_as(5);
INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id) VALUES(pg_temp.ac_id(801),pg_temp.ac_id(5),pg_temp.ac_id(311));
INSERT INTO public.coach_assessment_notes(id,assessment_id,coach_user_id,note) VALUES(pg_temp.ac_id(802),pg_temp.ac_id(801),pg_temp.ac_id(5),'SYNTHETIC PRIVATE NOTE');
INSERT INTO public.recognition_awards(id,coach_user_id,squad_player_id,award_type) VALUES(pg_temp.ac_id(803),pg_temp.ac_id(5),pg_temp.ac_id(311),'effort');
INSERT INTO public.coach_sessions(id,coach_user_id,title) VALUES(pg_temp.ac_id(804),pg_temp.ac_id(5),'Synthetic training');
INSERT INTO public.session_attendance(id,session_id,squad_player_id) VALUES(pg_temp.ac_id(805),pg_temp.ac_id(804),pg_temp.ac_id(311));
INSERT INTO public.meeting_requests(id,coach_user_id,squad_player_id,reason) VALUES(pg_temp.ac_id(806),pg_temp.ac_id(5),pg_temp.ac_id(311),'Synthetic development discussion');
SELECT pg_temp.ac_as(11);
INSERT INTO public.matches(id,user_id,position,competition,venue,age_group,consent_organization_id)
VALUES(pg_temp.ac_id(807),pg_temp.ac_id(11),'mid','Synthetic','Test','U18',pg_temp.ac_id(101));

SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801),'player reads own approved assessment');
SELECT pg_temp.ac_check(pg_temp.dr_visible('matches',807),'player reads own approved match');
SELECT pg_temp.ac_check(pg_temp.dr_visible('session_attendance',805),'player reads own approved attendance');
SELECT pg_temp.ac_check(pg_temp.dr_visible('recognition_awards',803),'player reads own approved recognition');
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessment_notes',802),'player never reads private coach notes');
SELECT pg_temp.ac_check(pg_temp.dr_visible('meeting_requests',806),'player keeps the existing approved meeting audience');
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801) AND pg_temp.dr_visible('matches',807) AND pg_temp.dr_visible('recognition_awards',803) AND pg_temp.dr_visible('meeting_requests',806),'approving parent reads the four permitted record types');
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessment_notes',802),'parent never reads private coach notes');
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('session_attendance',805),'consent does not broaden the existing attendance audience');
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',899),'unresolved legacy provenance does not borrow a current approval');
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',813) AND NOT pg_temp.dr_visible('coach_assessments',815),'unknown or future DOB blocks development reading');
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801),'one guardian visibility choice applies to the other linked parent');
SELECT pg_temp.ac_as(3);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'unverified linked parent cannot read development records');
SELECT pg_temp.ac_as(4);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'unlinked parent cannot read development records');
SELECT pg_temp.ac_as(5);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801) AND pg_temp.dr_visible('coach_assessment_notes',802)
 AND pg_temp.dr_visible('recognition_awards',803) AND pg_temp.dr_visible('session_attendance',805)
 AND pg_temp.dr_visible('meeting_requests',806),'current coach retains the five existing permitted record audiences');
SELECT pg_temp.ac_as(6);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801) AND NOT pg_temp.dr_visible('coach_assessment_notes',802),'another academy coach cannot read academy A records');
SELECT pg_temp.ac_as(16);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801) AND pg_temp.dr_visible('recognition_awards',803),'academy administrator reads approved academy records');
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessment_notes',802),'academy administrator does not inherit private coach notes');
SELECT pg_temp.ac_as(17);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'other academy administrator cannot read A');

-- Visibility is independent of coaching and one eligible guardian can restore it.
SELECT pg_temp.ac_as(1);
SELECT set_config('trak.dr_first',pg_temp.ac_grant(11,101,802,201,current_setting('trak.dr_first')::uuid,
 '{"coaching_records":true,"recognition":true,"parent_visibility":false}')->>'event_id',true);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801) AND NOT pg_temp.dr_visible('matches',807)
 AND NOT pg_temp.dr_visible('recognition_awards',803),'declining parent visibility hides development from that parent');
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'visibility off applies to all linked parents');
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',880),'academy A visibility choice does not remove B approval');
SELECT pg_temp.ac_as(11);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801),'visibility decline does not stop the player coaching view');
SELECT pg_temp.ac_as(5);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801),'visibility decline does not stop the coach view');
SELECT pg_temp.ac_as(2);
SELECT set_config('trak.dr_second',pg_temp.ac_grant(11,101,803,201,NULL,
 '{"coaching_records":true,"recognition":false,"parent_visibility":true}')->>'event_id',true);
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801),'another guardian restores visibility for the first parent');
SELECT set_config('trak.dr_first',pg_temp.ac_grant(11,101,804,201,current_setting('trak.dr_first')::uuid,
 '{"coaching_records":true,"recognition":false,"parent_visibility":false}')->>'event_id',true);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('recognition_awards',803) AND pg_temp.dr_visible('coach_assessments',801),'recognition decline hides awards but preserves coaching visibility');
SELECT pg_temp.ac_as(11);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('recognition_awards',803),'recognition decline also applies to the player');
SELECT pg_temp.ac_as(5);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('recognition_awards',803),'recognition decline also applies to the coach');
SELECT pg_temp.ac_as(16);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('recognition_awards',803),'recognition decline also applies to academy administrator');
SELECT pg_temp.ac_as(2);
SELECT public.withdraw_academy_consent(pg_temp.ac_id(11),pg_temp.ac_id(101),pg_temp.ac_id(805),current_setting('trak.dr_second')::uuid);
SELECT pg_temp.ac_as(5);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801),'another guardian keeps coaching reads active after one withdraws');
SELECT pg_temp.ac_as(1);
SELECT public.withdraw_academy_consent(pg_temp.ac_id(11),pg_temp.ac_id(101),pg_temp.ac_id(806),current_setting('trak.dr_first')::uuid);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801) AND NOT pg_temp.dr_visible('matches',807),'last withdrawal stops parent reads');
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',880),'withdrawing academy A does not stop approved academy B reading');
SELECT pg_temp.ac_as(11);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801) AND NOT pg_temp.dr_visible('matches',807)
 AND NOT pg_temp.dr_visible('session_attendance',805),'last withdrawal stops player development reads');
SELECT pg_temp.ac_as(5);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801) AND NOT pg_temp.dr_visible('coach_assessment_notes',802)
 AND NOT pg_temp.dr_visible('session_attendance',805) AND NOT pg_temp.dr_visible('meeting_requests',806),'last withdrawal stops all coach development reads');
SELECT pg_temp.ac_check(EXISTS(SELECT 1 FROM public.squad_players WHERE id=pg_temp.ac_id(311)),'minimal roster remains available to request consent');
SELECT pg_temp.ac_as(16);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'last withdrawal stops academy development reads');
SELECT pg_temp.ac_reset();
SELECT pg_temp.ac_check(EXISTS(SELECT 1 FROM public.coach_assessments WHERE id=pg_temp.ac_id(801)) AND EXISTS(SELECT 1 FROM public.matches WHERE id=pg_temp.ac_id(807)),'withdrawal hides rather than silently destroys retained records');

-- Current notice and verification changes invalidate old approvals immediately.
SELECT pg_temp.ac_as(1);
SELECT set_config('trak.dr_first',pg_temp.ac_grant(11,101,807,201,(pg_temp.ac_context(11,101)->>'current_event_id')::uuid,
 '{"coaching_records":true,"recognition":true,"parent_visibility":true}')->>'event_id',true);
SELECT pg_temp.ac_reset();
UPDATE auth.users SET email_confirmed_at=NULL WHERE id=pg_temp.ac_id(1);
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'loss of approving guardian verification removes visibility');
SELECT pg_temp.ac_reset();
UPDATE auth.users SET email_confirmed_at=now() WHERE id=pg_temp.ac_id(1);
UPDATE trak_consent.programs SET notice_id=pg_temp.ac_id(203) WHERE organization_id=pg_temp.ac_id(101);
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'new notice needs new approval before reading');
SELECT pg_temp.ac_as(1);
SELECT set_config('trak.dr_first',pg_temp.ac_grant(11,101,808,203,current_setting('trak.dr_first')::uuid,
 '{"coaching_records":true,"recognition":true,"parent_visibility":true}')->>'event_id',true);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801),'approving the current notice restores reading');
SELECT pg_temp.ac_reset();
UPDATE trak_consent.programs SET enabled=false WHERE organization_id=pg_temp.ac_id(101);
SELECT pg_temp.ac_as(11);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'disabled academy program stops development reading');
SELECT pg_temp.ac_reset();
UPDATE trak_consent.programs SET enabled=true WHERE organization_id=pg_temp.ac_id(101);
UPDATE public.player_details SET date_of_birth=current_date-interval '18 years' WHERE user_id=pg_temp.ac_id(11);
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check(NOT pg_temp.dr_visible('coach_assessments',801),'guardian visibility does not carry past adulthood');
SELECT pg_temp.ac_as(11);
SELECT pg_temp.ac_check(pg_temp.dr_visible('coach_assessments',801) AND NOT pg_temp.dr_visible('recognition_awards',803),'adult keeps coaching access without inferring optional recognition');
SELECT pg_temp.ac_reset();
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(description||coalesce(' ['||detail||']',''),E'\n') INTO failures FROM ac_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Academy consent read assertions failed' USING DETAIL=failures; END IF;
END $$;
SELECT count(*) AS academy_consent_read_assertions FROM ac_results;
ROLLBACK;

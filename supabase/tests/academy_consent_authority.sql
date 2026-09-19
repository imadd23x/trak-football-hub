-- @trak-suite mode=--academy-consent-review in-all=true
-- Only synthetic fixtures. This tests the new authority, not development gates.
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

-- Legacy evidence must not grant academy consent.
INSERT INTO public.parental_consents(player_user_id,parent_user_id,relationship_declared,verification_method,
 purposes,notice_version,consent_text,threshold_age,player_age_at_consent)
VALUES(pg_temp.ac_id(11),pg_temp.ac_id(1),'parent','email_confirmed',
 '{"coaching_records":true,"recognition":true,"parent_visibility":true}','legacy-test','SYNTHETIC LEGACY',15,14);
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check((pg_temp.ac_context(11,101)->>'coaching_approved')::boolean=false,'legacy approval is not an academy approval');
SELECT pg_temp.ac_check(pg_temp.ac_context(11,101)#>>'{notice,body}'='SYNTHETIC TEST NOTICE A','server returns the exact named academy notice');
SELECT pg_temp.ac_check(pg_temp.ac_context(11,101)->>'threshold'='18','new authority uses agreed under-18 policy');
SELECT set_config('trak.ac_first',pg_temp.ac_grant(11,101,501,201)->>'event_id',true);
SELECT pg_temp.ac_check((pg_temp.ac_context(11,101)->>'coaching_approved')::boolean,'17-year-old grant enables academy A');
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,101)->>'recognition_approved')::boolean,'optional recognition remains off');
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,102)->>'coaching_approved')::boolean,'academy A approval never approves B');
SELECT pg_temp.ac_check((pg_temp.ac_grant(11,101,501,201)->>'replayed')::boolean,'identical request retry succeeds');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(11,102,501,202)$s$,'22023','request UUID cannot be reused for another academy');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(11,101,502,201)$s$,'40001','stale expected decision cannot overwrite a grant');
SELECT pg_temp.ac_reset();
SELECT pg_temp.ac_check((SELECT count(*)=1 FROM trak_consent.events),'retry creates no duplicate audit event');

-- Guardian two enables all purposes; guardian one withdrawing must not undo it.
SELECT pg_temp.ac_as(2);
SELECT set_config('trak.ac_second',pg_temp.ac_grant(11,101,503,201,NULL,
 '{"coaching_records":true,"recognition":true,"parent_visibility":true}')->>'event_id',true);
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check((pg_temp.ac_context(11,101)->>'parent_visibility_approved')::boolean,'one guardian visibility choice applies to other linked parents');
SELECT pg_temp.ac_check((pg_temp.ac_context(11,101)->>'recognition_approved')::boolean,'another guardian can approve recognition');
SELECT set_config('trak.ac_withdraw',public.withdraw_academy_consent(pg_temp.ac_id(11),pg_temp.ac_id(101),pg_temp.ac_id(504),current_setting('trak.ac_first')::uuid)->>'event_id',true);
SELECT pg_temp.ac_check((pg_temp.ac_context(11,101)->>'coaching_approved')::boolean,'one withdrawal leaves another guardian approval active');
SELECT pg_temp.ac_check(pg_temp.ac_context(11,101)->>'action'='withdraw','caller sees own withdrawal separately');
SELECT pg_temp.ac_check(pg_temp.ac_grant(11,101,501,201)->>'current_event_id'=current_setting('trak.ac_withdraw'),'lost-response retry returns current withdrawal and does not reactivate');
SELECT pg_temp.ac_error(format('SELECT pg_temp.ac_grant(11,101,505,201,%L::uuid)',current_setting('trak.ac_first')),'40001','delayed stale grant cannot undo withdrawal');
SELECT pg_temp.ac_as(2);
SELECT public.withdraw_academy_consent(pg_temp.ac_id(11),pg_temp.ac_id(101),pg_temp.ac_id(506),current_setting('trak.ac_second')::uuid);
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,101)->>'coaching_approved')::boolean,'all guardians withdrawn stops approval');
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,101)->>'parent_visibility_approved')::boolean,'all guardians withdrawn stops shared parent visibility');

-- Two academies remain independent, and only a parent's own event is mutable.
SELECT pg_temp.ac_as(1);
SELECT set_config('trak.ac_b',pg_temp.ac_grant(11,102,507,202)->>'event_id',true);
SELECT pg_temp.ac_check((pg_temp.ac_context(11,102)->>'coaching_approved')::boolean,'fresh B approval works independently');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(12,101,508,201)$s$,'42501','linked child must belong to requested academy');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(12,102,509,201)$s$,'42501','notice cannot be substituted from another academy');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(13,101,510,201)$s$,'22023','missing DOB cannot grant');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(14,101,511,201)$s$,'22023','18-year-old does not get a minor guardian grant');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(15,101,512,201)$s$,'22023','future DOB cannot grant');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(12,102,513,202,NULL,'{"coaching_records":true}')$s$,'22023','missing purpose keys fail');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(12,102,514,202,NULL,'{"coaching_records":true,"recognition":"true","parent_visibility":false}')$s$,'22023','string purpose values fail');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(12,102,515,202,NULL,'{"coaching_records":true,"recognition":false,"parent_visibility":false,"extra":true}')$s$,'22023','extra purpose keys fail');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(12,102,516,202,NULL,'{"coaching_records":false,"recognition":false,"parent_visibility":false}')$s$,'22023','a refusal cannot be stored as a grant');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(12,102,517,202,NULL,'{"coaching_records":true,"recognition":null,"parent_visibility":false}')$s$,'22023','JSON null is not a boolean');
SELECT pg_temp.ac_error('SELECT * FROM trak_consent.events','42501','parents cannot read the private ledger directly');
SELECT pg_temp.ac_error('DELETE FROM trak_consent.decisions','42501','parents cannot mutate the state table');
SELECT pg_temp.ac_error($s$SELECT trak_consent.has_guardian_approval(pg_temp.ac_id(11),pg_temp.ac_id(101),'coaching_records')$s$,'42501','internal approval predicate is not a public oracle');
SELECT pg_temp.ac_as(3);
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(11,101,518,201)$s$,'42501','unverified linked parent cannot grant');
SELECT pg_temp.ac_as(4);
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(11,101,519,201)$s$,'42501','unlinked parent cannot grant');
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_context(11,101)$s$,'42501','unlinked parent cannot inspect context');
SELECT pg_temp.ac_as(5);
SELECT pg_temp.ac_error($s$SELECT pg_temp.ac_grant(11,101,520,201)$s$,'42501','a linked non-parent role cannot grant');
SELECT pg_temp.ac_reset();
SET LOCAL ROLE anon;
SELECT pg_temp.ac_error($s$SELECT public.get_academy_consent_context(pg_temp.ac_id(11),pg_temp.ac_id(101))$s$,'42501','anonymous caller cannot use wrapper');
SELECT pg_temp.ac_reset();

-- Immutable evidence and live eligibility, rather than retained rows alone.
SELECT pg_temp.ac_error('UPDATE trak_consent.events SET action=action','55000','even an owner update cannot silently rewrite events');
SELECT pg_temp.ac_error('DELETE FROM trak_consent.events','55000','even an owner delete cannot silently erase events');
SELECT pg_temp.ac_error('UPDATE trak_consent.notices SET body=body','55000','approved notice text cannot change in place');
UPDATE public.player_details SET date_of_birth=NULL WHERE user_id=pg_temp.ac_id(11);
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,102)->>'coaching_approved')::boolean,'missing current child DOB never authorizes from a retained grant');
SELECT pg_temp.ac_reset();
UPDATE public.player_details SET date_of_birth=current_date-interval '18 years' WHERE user_id=pg_temp.ac_id(11);
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,102)->>'parent_visibility_approved')::boolean
  AND NOT (pg_temp.ac_context(11,102)->>'coaching_approved')::boolean,'guardian authority ends at adulthood');
SELECT pg_temp.ac_reset();
UPDATE public.player_details SET date_of_birth=current_date-interval '17 years' WHERE user_id=pg_temp.ac_id(11);
UPDATE auth.users SET email_confirmed_at=NULL WHERE id=pg_temp.ac_id(1);
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,102)->>'coaching_approved')::boolean,'unverified guardian no longer authorizes processing');
SELECT pg_temp.ac_reset();
UPDATE auth.users SET email_confirmed_at=now() WHERE id=pg_temp.ac_id(1);
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check((pg_temp.ac_context(11,102)->>'coaching_approved')::boolean,'restored verified guardian is a positive control');
SELECT pg_temp.ac_reset();
DELETE FROM public.player_parent_links WHERE player_user_id=pg_temp.ac_id(11) AND parent_user_id=pg_temp.ac_id(1);
SELECT pg_temp.ac_as(2);
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,102)->>'coaching_approved')::boolean,'revoked guardian link removes authority');
SELECT pg_temp.ac_as(1);
SELECT public.withdraw_academy_consent(pg_temp.ac_id(11),pg_temp.ac_id(102),pg_temp.ac_id(521),current_setting('trak.ac_b')::uuid);
SELECT pg_temp.ac_check(pg_temp.ac_context(11,102)->>'action'='withdraw','guardian can withdraw existing evidence after link removal');
SELECT pg_temp.ac_reset();
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES(pg_temp.ac_id(11),pg_temp.ac_id(1));
SELECT pg_temp.ac_as(1);
SELECT set_config('trak.ac_again',pg_temp.ac_grant(11,101,522,201,current_setting('trak.ac_withdraw')::uuid)->>'event_id',true);
SELECT pg_temp.ac_reset();
UPDATE trak_consent.programs SET notice_id=pg_temp.ac_id(203) WHERE organization_id=pg_temp.ac_id(101);
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,101)->>'coaching_approved')::boolean,'new notice requires a new approval');
SELECT pg_temp.ac_error(format('SELECT pg_temp.ac_grant(11,101,523,201,%L::uuid)',current_setting('trak.ac_again')),'42501','old notice cannot be submitted after replacement');
SELECT set_config('trak.ac_newnotice',pg_temp.ac_grant(11,101,524,203,current_setting('trak.ac_again')::uuid)->>'event_id',true);
SELECT pg_temp.ac_check((pg_temp.ac_context(11,101)->>'coaching_approved')::boolean,'new notice approval restores authority');
SELECT pg_temp.ac_reset();
UPDATE trak_consent.programs SET enabled=false WHERE organization_id=pg_temp.ac_id(101);
SELECT pg_temp.ac_as(1);
SELECT pg_temp.ac_check(NOT (pg_temp.ac_context(11,101)->>'coaching_approved')::boolean,'disabled academy cannot process on retained approval');
SELECT pg_temp.ac_error(format('SELECT pg_temp.ac_grant(11,101,525,203,%L::uuid)',current_setting('trak.ac_newnotice')),'42501','disabled program cannot receive new grants');
SELECT pg_temp.ac_reset();
SELECT pg_temp.ac_check((SELECT count(*)=1 FROM public.parental_consents WHERE player_user_id=pg_temp.ac_id(11)),'legacy evidence is untouched');
DO $$ DECLARE failures text; BEGIN
  SELECT string_agg(description||COALESCE(' ['||detail||']',''),E'\n') INTO failures FROM pg_temp.ac_results WHERE NOT passed;
  IF failures IS NOT NULL THEN RAISE EXCEPTION 'Academy consent authority failed' USING DETAIL=failures; END IF;
END $$;
SELECT count(*) AS academy_consent_authority_assertions FROM pg_temp.ac_results;
ROLLBACK;

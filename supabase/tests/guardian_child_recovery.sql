-- @trak-suite mode=--child-recovery-review in-all=true
-- TRAK-84 J3: actual SQL roles, synthetic identities, disposable database only.
BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Disposable database required';
  END IF;
END $$;
CREATE FUNCTION pg_temp.cl(n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('98c00000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.cl_as(n int) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.cl(n))::text,true)::text::void
$$;
CREATE FUNCTION pg_temp.cl_refuse(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE = expected THEN RETURN; END IF;
   RAISE EXCEPTION 'Expected %, got %: %', expected, SQLSTATE, SQLERRM;
 END;
 RAISE EXCEPTION 'Unexpectedly permitted: %', statement;
END $$;
CREATE FUNCTION pg_temp.cl_check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 (pg_temp.cl(1),'admin@child-login.test',now()),
 (pg_temp.cl(2),'coach@child-login.test',now()),
 (pg_temp.cl(3),'parent@child-login.test',now()),
 (pg_temp.cl(4),'stranger@child-login.test',now()),
 (pg_temp.cl(5),'other-guardian@child-login.test',now());
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.cl(1),'club','Synthetic Admin'),(pg_temp.cl(2),'coach','Synthetic Coach'),
 (pg_temp.cl(3),'parent','Synthetic Parent'),(pg_temp.cl(4),'parent','Other Parent'),
 (pg_temp.cl(5),'parent','Second Guardian');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.cl(10),pg_temp.cl(1),'Child Login Academy','CL-ACADEMY');
INSERT INTO public.coach_details(user_id,organization_id) VALUES (pg_temp.cl(2),pg_temp.cl(10));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group) VALUES
 (pg_temp.cl(20),pg_temp.cl(2),'Ana7 Synthetic','U14'),
 (pg_temp.cl(21),pg_temp.cl(2),'Ben Synthetic','U14'),
 (pg_temp.cl(22),pg_temp.cl(2),'Cleo Synthetic','U14'),
 (pg_temp.cl(23),pg_temp.cl(2),'Dena Synthetic','U14');
INSERT INTO public.roster_children(id,organization_id,squad_player_id,date_of_birth,child_email,loaded_by) VALUES
 (pg_temp.cl(30),pg_temp.cl(10),pg_temp.cl(20),'2013-01-01',null,'fixture'),
 (pg_temp.cl(31),pg_temp.cl(10),pg_temp.cl(21),'2013-01-01',null,'fixture'),
 (pg_temp.cl(32),pg_temp.cl(10),pg_temp.cl(22),'2013-01-01','cleo@child-login.test','fixture'),
 (pg_temp.cl(33),pg_temp.cl(10),pg_temp.cl(23),'2013-01-01',null,'fixture');
INSERT INTO public.roster_guardians(roster_child_id,email,parent_user_id,loaded_by) SELECT
 pg_temp.cl(n),'parent@child-login.test',pg_temp.cl(3),'fixture' FROM generate_series(30,33) n;
INSERT INTO public.roster_guardians(roster_child_id,email,parent_user_id,loaded_by)
 VALUES(pg_temp.cl(31),'other-guardian@child-login.test',pg_temp.cl(5),'fixture');

SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_as(3);
SELECT public.record_roster_consent(pg_temp.cl(30),'parent','{"coaching_records":true}','synthetic','Synthetic notice');
CREATE TEMP TABLE reservation AS SELECT * FROM public.reserve_child_login(pg_temp.cl(30),'striker7');
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) SELECT pg_temp.cl(40),
 'striker7@child.trakfootball.com',now(),jsonb_build_object('trak_child_login',true,'child_login_reservation',reservation_id,'child_login_guardian',pg_temp.cl(3)) FROM reservation;
-- Another guardian of the same child may recover the login; their own consent
-- need not replace a current family consent just to recover credentials.
INSERT INTO public.roster_guardians(roster_child_id,email,parent_user_id,loaded_by)
 VALUES(pg_temp.cl(30),'other-guardian@child-login.test',pg_temp.cl(5),'fixture');
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_as(4);
SELECT pg_temp.cl_check(NOT EXISTS(SELECT 1 FROM public.get_my_child_credentials()),'wrong family receives no usernames');
SELECT pg_temp.cl_refuse($s$SELECT authorize_child_password_reset('98c00000-0000-4000-8000-000000000030')$s$,'42501');
SELECT pg_temp.cl_as(5);
SELECT pg_temp.cl_check((SELECT username='striker7' FROM public.get_my_child_credentials()),'second claimed guardian sees username before first run');
SELECT pg_temp.cl_check(public.authorize_child_password_reset(pg_temp.cl(30))=pg_temp.cl(40),'second guardian resolves exact owned Auth target');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=NULL WHERE id=pg_temp.cl(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_refuse($s$SELECT authorize_child_password_reset('98c00000-0000-4000-8000-000000000030')$s$,'42501');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now() WHERE id=pg_temp.cl(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_as(40);
SELECT public.provision_my_profile('{"role":"player","full_name":"Ana7 Synthetic","player_details":{"position":"Defender"}}');
SELECT pg_temp.cl_as(3);
SELECT pg_temp.cl_check(public.authorize_child_password_reset(pg_temp.cl(30))=pg_temp.cl(40),'linked guardian recovers after profile admission');
SELECT public.withdraw_parental_consent(pg_temp.cl(40));
SELECT pg_temp.cl_refuse($s$SELECT authorize_child_password_reset('98c00000-0000-4000-8000-000000000030')$s$,'42501');
SELECT pg_temp.cl_check(NOT EXISTS(SELECT 1 FROM public.get_my_child_credentials()),'withdrawn family hides credential actions');
SELECT pg_temp.cl_as(5);
SELECT public.record_parental_consent(pg_temp.cl(40),'parent','{"coaching_records":true}','synthetic','Synthetic notice');
SELECT pg_temp.cl_check(public.authorize_child_password_reset(pg_temp.cl(30))=pg_temp.cl(40),'reapproval without roster-child pointer restores recovery');
SELECT pg_temp.cl_as(3);
SELECT pg_temp.cl_check(public.authorize_child_password_reset(pg_temp.cl(30))=pg_temp.cl(40),'either linked guardian can recover with active family consent');
RESET ROLE;
DELETE FROM public.player_parent_links WHERE parent_user_id=pg_temp.cl(3) AND player_user_id=pg_temp.cl(40);
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_as(3);
SELECT pg_temp.cl_refuse($s$SELECT authorize_child_password_reset('98c00000-0000-4000-8000-000000000030')$s$,'42501');
SELECT pg_temp.cl_refuse($s$SELECT authorize_child_password_reset('98c00000-0000-4000-8000-000000000032')$s$,'42501');
SELECT pg_temp.cl_check(NOT EXISTS(SELECT 1 FROM public.get_my_child_credentials()),'removed player link defeats a surviving roster claim');
SET LOCAL ROLE anon;
SELECT pg_temp.cl_refuse($s$SELECT * FROM public.get_my_child_credentials()$s$,'42501');
SELECT pg_temp.cl_refuse($s$SELECT authorize_child_password_reset('98c00000-0000-4000-8000-000000000030')$s$,'42501');
RESET ROLE;
ROLLBACK;

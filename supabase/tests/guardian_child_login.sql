-- @trak-suite mode=--child-login-review in-all=true
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
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000030','striker7')$s$,'42501');
SELECT public.record_roster_consent(pg_temp.cl(30),'parent','{"coaching_records":true}', 'synthetic','Synthetic notice');
SELECT public.record_roster_consent(pg_temp.cl(31),'parent','{"coaching_records":true}', 'synthetic','Synthetic notice');
SELECT public.record_roster_consent(pg_temp.cl(32),'parent','{"coaching_records":true}', 'synthetic','Synthetic notice');
SELECT public.record_roster_consent(pg_temp.cl(33),'parent','{"coaching_records":true}', 'synthetic','Synthetic notice');
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000032','runner8')$s$,'42501');
SELECT pg_temp.cl_as(4);
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000030','striker7')$s$,'42501');
SELECT pg_temp.cl_as(3);
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000030','ana7')$s$,'22023');
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000030','no-digit')$s$,'22023');
SAVEPOINT name_control;
SELECT public.reserve_child_login(pg_temp.cl(30),'canada7');
ROLLBACK TO name_control;
SELECT pg_temp.cl_check((SELECT count(*)=3 FROM public.get_my_child_logins()),'reload lists consented email-less children');
CREATE TEMP TABLE reservation AS SELECT * FROM public.reserve_child_login(pg_temp.cl(30),'striker7');
SELECT pg_temp.cl_check((SELECT r.reservation_id = t.reservation_id FROM public.reserve_child_login(pg_temp.cl(30),'striker7') r CROSS JOIN reservation t),'retry keeps same reservation');
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000030','newrunner8')$s$,'23505');
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000031','striker7')$s$,'23505');
RESET ROLE;
-- Auth insertion is one transaction with binding the exact owned reservation.
SELECT pg_temp.cl_refuse($s$INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('98c00000-0000-4000-8000-000000000040','striker7@child.trakfootball.com',now(),'{"trak_child_login":true}')$s$,'42501');
-- Supabase Admin creates the initial user, then updates trusted metadata and
-- confirmation inside the same transaction. Validate the final persisted row.
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 (pg_temp.cl(40),'striker7@child.trakfootball.com','{"provider":"email","providers":["email"]}');
UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data ||
 (SELECT jsonb_build_object('trak_child_login',true,'child_login_reservation',reservation_id,'child_login_guardian',pg_temp.cl(3)) FROM reservation)
 WHERE id=pg_temp.cl(40);
UPDATE auth.users SET email_confirmed_at=now() WHERE id=pg_temp.cl(40);
SELECT pg_temp.cl_check((SELECT auth_user_id IS NULL FROM public.child_logins WHERE roster_child_id=pg_temp.cl(30)), 'binding waits for the completed Auth transaction');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.cl_check((SELECT child_email='striker7@child.trakfootball.com' AND player_user_id IS NULL FROM public.roster_children WHERE id=pg_temp.cl(30)),'Auth creation binds email, first run still admits profile');
SET LOCAL ROLE service_role;
SELECT pg_temp.cl_check(NOT EXISTS(SELECT 1 FROM public.roster_invite_targets(pg_temp.cl(30),pg_temp.cl(3)) WHERE kind='child'),'technical child is never an invitation target');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_as(3);
SELECT pg_temp.cl_check((SELECT username='striker7' AND ready FROM public.get_my_child_logins() WHERE roster_child_id=pg_temp.cl(30)),'parent receives username/ready only');
SELECT pg_temp.cl_refuse($s$SELECT * FROM public.child_logins$s$,'42501');
SELECT pg_temp.cl_as(40);
SELECT public.provision_my_profile('{"role":"player","full_name":"Ana Synthetic","player_details":{"position":"Defender"}}');
RESET ROLE;
SELECT pg_temp.cl_check((SELECT linked_player_id=pg_temp.cl(40) FROM public.squad_players WHERE id=pg_temp.cl(20)),'first run keeps original squad row');
SELECT pg_temp.cl_check(public.player_has_parental_consent(pg_temp.cl(40)),'consent follows child');
SELECT pg_temp.cl_check(EXISTS(SELECT 1 FROM public.player_parent_links WHERE player_user_id=pg_temp.cl(40) AND parent_user_id=pg_temp.cl(3)),'first run links existing guardian');
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_as(3);
SELECT public.reserve_child_login(pg_temp.cl(31),'runner8');
SELECT pg_temp.cl_as(5);
SELECT public.record_roster_consent(pg_temp.cl(31),'parent','{"coaching_records":true}', 'synthetic','Synthetic notice');
SELECT public.reserve_child_login(pg_temp.cl(31),'runner8');
RESET ROLE;
SELECT pg_temp.cl_check((SELECT created_by=pg_temp.cl(5) FROM public.child_logins WHERE roster_child_id=pg_temp.cl(31)), 'active second guardian can resume a pending reservation');
SELECT pg_temp.cl_refuse($s$INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) SELECT
 pg_temp.cl(42),'runner8@child.trakfootball.com',now(),jsonb_build_object('trak_child_login',true,'child_login_reservation',id,'child_login_guardian',pg_temp.cl(3)) FROM public.child_logins WHERE roster_child_id=pg_temp.cl(31)$s$,'42501');
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) SELECT
 pg_temp.cl(41),'runner8@child.trakfootball.com',now(),jsonb_build_object('trak_child_login',true,'child_login_reservation',id,'child_login_guardian',pg_temp.cl(5)) FROM public.child_logins WHERE roster_child_id=pg_temp.cl(31);
SELECT pg_temp.cl_check((SELECT auth_user_id=pg_temp.cl(41) FROM public.child_logins WHERE roster_child_id=pg_temp.cl(31)), 'second guardian completes same owned reservation; stale first request cannot');
SET LOCAL ROLE authenticated;
SELECT pg_temp.cl_as(3);
SELECT public.reserve_child_login(pg_temp.cl(33),'winger9');
SELECT public.withdraw_roster_consent(pg_temp.cl(33));
RESET ROLE;
SELECT pg_temp.cl_refuse($s$INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) SELECT
 pg_temp.cl(43),'winger9@child.trakfootball.com',now(),jsonb_build_object('trak_child_login',true,'child_login_reservation',id,'child_login_guardian',pg_temp.cl(3)) FROM public.child_logins WHERE roster_child_id=pg_temp.cl(33)$s$,'42501');
SELECT pg_temp.cl_check(NOT EXISTS(SELECT 1 FROM auth.users WHERE id=pg_temp.cl(43)),'withdrawal refuses Auth identity atomically');
SET LOCAL ROLE anon;
SELECT pg_temp.cl_refuse($s$SELECT * FROM get_my_child_logins()$s$,'42501');
SELECT pg_temp.cl_refuse($s$SELECT reserve_child_login('98c00000-0000-4000-8000-000000000030','striker7')$s$,'42501');
RESET ROLE;
ROLLBACK;

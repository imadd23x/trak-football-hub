-- @trak-suite mode=--season-plans in-all=true
-- TRAK-350 (Season plan 2/18, spec TRAK-348): a squad's season plan and its season objectives, a draft only the
-- squad's coach sees. No other coach, academy admin, player, guardian or anon reads or writes it. Writes need the
-- academy's season_plan switch on; reads don't, so switching it off loses nothing. One plan per squad, three
-- objectives at most, and a deleted objective is gone only while the plan is a draft. Bad values are refused, and a
-- coach never writes the owner, the squad after the start, or the shared time. Synthetic fixtures; the suite rolls
-- back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing season-plans fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.sp350id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93500000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE sp350_results(label text, ok boolean);
GRANT SELECT, INSERT ON sp350_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.sp350actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.sp350id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.sp350check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.sp350_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.sp350refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- How many rows a statement changed (0 when a rule hid them).
CREATE FUNCTION pg_temp.sp350changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- The U16 plan's id, read back by its coach: nobody chooses a plan's id.
CREATE TEMP TABLE sp350_plan(id uuid);
GRANT SELECT, INSERT ON sp350_plan TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.sp350plan() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM pg_temp.sp350_plan LIMIT 1 $$;
CREATE FUNCTION pg_temp.sp350count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Coach One (10) has U16 and U14 in On; Coach Two
-- (11) coaches in On too; Coach Three (12) has U16 in Off. Player Pat (20) is on Coach One's U16, and Gina (30) is
-- Pat's guardian. Admin On (1) and Admin Off (2) run the academies.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.sp350id(n),'synthetic-'||n||'@season350.invalid',now() FROM unnest(ARRAY[1,2,10,11,12,20,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.sp350id(1),'club','Synthetic Admin On'),(pg_temp.sp350id(2),'club','Synthetic Admin Off'),
 (pg_temp.sp350id(10),'coach','Synthetic Coach One'),(pg_temp.sp350id(11),'coach','Synthetic Coach Two'),
 (pg_temp.sp350id(12),'coach','Synthetic Coach Three'),
 (pg_temp.sp350id(20),'player','Synthetic Player Pat'),(pg_temp.sp350id(30),'parent','Synthetic Guardian Gina');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.sp350id(100),pg_temp.sp350id(1),'Season On Academy','S350N1'),
 (pg_temp.sp350id(101),pg_temp.sp350id(2),'Season Off Academy','S350F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.sp350id(10),pg_temp.sp350id(100)),(pg_temp.sp350id(11),pg_temp.sp350id(100)),(pg_temp.sp350id(12),pg_temp.sp350id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES (pg_temp.sp350id(20),current_date - interval '15 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES (pg_temp.sp350id(20),pg_temp.sp350id(30));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.sp350id(40),pg_temp.sp350id(10),'Synthetic Player Pat','U16',pg_temp.sp350id(20)),
 (pg_temp.sp350id(41),pg_temp.sp350id(10),'Synthetic Player Quinn','U14',NULL),
 (pg_temp.sp350id(42),pg_temp.sp350id(12),'Synthetic Player Rae','U16',NULL);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.sp350id(100),'season_plan');

SET LOCAL ROLE authenticated;

-- 1. The squad's coach starts a draft and fills it.
SELECT pg_temp.sp350actor(10);
SELECT pg_temp.sp350check(pg_temp.sp350changed(
  'INSERT INTO public.season_plans(squad,starts_on,ends_on) VALUES(''U16'',''2026-09-01'',''2027-06-30'')') = 1,
  '1 the coach starts a plan for their own U16');
INSERT INTO pg_temp.sp350_plan SELECT id FROM public.season_plans WHERE squad = 'U16';
SELECT pg_temp.sp350check((SELECT coach_user_id FROM public.season_plans WHERE id = pg_temp.sp350plan()) = pg_temp.sp350id(10),
  '1 the plan is the coach''s without naming them');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format(
  'INSERT INTO public.season_objectives(plan_id,place,title,looks_like) VALUES(%L,1,''Win it back within 5 seconds'',''The nearest three press.''),(%L,2,''Stay compact'',''''),(%L,3,''Win the second ball'','''')',
  pg_temp.sp350plan(),pg_temp.sp350plan(),pg_temp.sp350plan())) = 3, '1 three objectives, one the coach''s own');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format(
  'UPDATE public.season_objectives SET title = ''Win it back within 6 seconds'' WHERE plan_id = %L AND place = 1',pg_temp.sp350plan())) = 1,
  '1 the coach edits an objective''s words');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format(
  'UPDATE public.season_plans SET ends_on = ''2027-05-31'' WHERE id = %L',pg_temp.sp350plan())) = 1, '1 the coach changes the dates');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format(
  'DELETE FROM public.season_objectives WHERE plan_id = %L AND place = 3',pg_temp.sp350plan())) = 1,
  '1 deleting an objective from a draft really deletes it');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format(
  'INSERT INTO public.season_plans(squad) VALUES(''U14'')')) = 1, '1 a plan with no dates and no objectives saves');

-- 2. What the coach can't do to their own plan.
SELECT pg_temp.sp350check(pg_temp.sp350refused('INSERT INTO public.season_plans(squad) VALUES(''U19'')','42501'),
  '2 no plan for a squad the coach doesn''t coach');
SELECT pg_temp.sp350check(pg_temp.sp350refused('INSERT INTO public.season_plans(squad) VALUES(''U16'')','23505'),
  '2 no second plan for the same squad');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format(
  'UPDATE public.season_plans SET ends_on = ''2026-08-01'' WHERE id = %L',pg_temp.sp350plan()),'23514'),
  '2 the season can''t end before it starts');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format(
  'INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,4,''A fourth'')',pg_temp.sp350plan()),'23514'),
  '2 no fourth place');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format(
  'INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,1,''Same place'')',pg_temp.sp350plan()),'23505'),
  '2 no two objectives in one place');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format('INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,3,''  '')',pg_temp.sp350plan()),'23514')
  AND pg_temp.sp350refused(format('INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,3,%L)',pg_temp.sp350plan(),repeat('x',81)),'23514')
  AND pg_temp.sp350refused(format('INSERT INTO public.season_objectives(plan_id,place,title,looks_like) VALUES(%L,3,''Fine'',%L)',pg_temp.sp350plan(),repeat('x',301)),'23514'),
  '2 an empty title, a title over 80 or a line over 300');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format('UPDATE public.season_plans SET shared_at = now() WHERE id = %L',pg_temp.sp350plan()),'42501')
  AND pg_temp.sp350refused(format('UPDATE public.season_plans SET coach_user_id = %L WHERE id = %L',pg_temp.sp350id(11),pg_temp.sp350plan()),'42501')
  AND pg_temp.sp350refused(format('UPDATE public.season_plans SET squad = ''U14'' WHERE id = %L',pg_temp.sp350plan()),'42501')
  AND pg_temp.sp350refused(format('INSERT INTO public.season_plans(squad,coach_user_id) VALUES(''U14'',%L)',pg_temp.sp350id(11)),'42501')
  AND pg_temp.sp350refused('INSERT INTO public.season_plans(squad,shared_at) VALUES(''U14'',now())','42501'),
  '2 the coach never writes the shared time, the owner or the squad after the start');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format('UPDATE public.season_objectives SET place = 3 WHERE plan_id = %L AND place = 2',pg_temp.sp350plan()),'42501')
  AND pg_temp.sp350refused(format('UPDATE public.season_objectives SET plan_id = (SELECT id FROM public.season_plans WHERE squad = ''U14'') WHERE plan_id = %L AND place = 2',pg_temp.sp350plan()),'42501'),
  '2 an objective keeps its plan and its place');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format('DELETE FROM public.season_plans WHERE id = %L',pg_temp.sp350plan()),'42501'),
  '2 nobody deletes a plan');

-- 3. Nobody else reads or writes it.
SELECT pg_temp.sp350actor(11);
SELECT pg_temp.sp350check(pg_temp.sp350count('SELECT count(*) FROM public.season_plans') = 0
  AND pg_temp.sp350count('SELECT count(*) FROM public.season_objectives') = 0, '3 another coach in the academy reads nothing');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format('UPDATE public.season_plans SET ends_on = ''2027-01-31'' WHERE id = %L',pg_temp.sp350plan())) = 0
  AND pg_temp.sp350changed(format('UPDATE public.season_objectives SET title = ''Theirs now'' WHERE plan_id = %L',pg_temp.sp350plan())) = 0
  AND pg_temp.sp350changed(format('DELETE FROM public.season_objectives WHERE plan_id = %L',pg_temp.sp350plan())) = 0,
  '3 another coach changes and deletes nothing');
SELECT pg_temp.sp350check(pg_temp.sp350refused(format(
  'INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,3,''Planted'')',pg_temp.sp350plan()),'42501'),
  '3 another coach can''t add to the plan');
SELECT pg_temp.sp350check(pg_temp.sp350refused('INSERT INTO public.season_plans(squad) VALUES(''U16'')','42501'),
  '3 another coach can''t start a plan for a squad that isn''t theirs');
SELECT pg_temp.sp350actor(12);
SELECT pg_temp.sp350check(pg_temp.sp350count('SELECT count(*) FROM public.season_plans') = 0,
  '3 a coach in another academy reads nothing');
SELECT pg_temp.sp350check(pg_temp.sp350refused('INSERT INTO public.season_plans(squad) VALUES(''U16'')','42501'),
  '3 with the switch off, a coach can''t start a plan for their own squad');
SELECT pg_temp.sp350actor(1);
SELECT pg_temp.sp350check(pg_temp.sp350count('SELECT count(*) FROM public.season_plans') = 0
  AND pg_temp.sp350count('SELECT count(*) FROM public.season_objectives') = 0, '3 the academy admin reads nothing');
SELECT pg_temp.sp350actor(20);
SELECT pg_temp.sp350check(pg_temp.sp350count('SELECT count(*) FROM public.season_plans') = 0
  AND pg_temp.sp350count('SELECT count(*) FROM public.season_objectives') = 0
  AND pg_temp.sp350refused('INSERT INTO public.season_plans(squad) VALUES(''U16'')','42501'), '3 the player reads and writes nothing');
SELECT pg_temp.sp350actor(30);
SELECT pg_temp.sp350check(pg_temp.sp350count('SELECT count(*) FROM public.season_plans') = 0
  AND pg_temp.sp350count('SELECT count(*) FROM public.season_objectives') = 0, '3 the guardian reads nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.sp350check(pg_temp.sp350refused('SELECT count(*) FROM public.season_plans','42501')
  AND pg_temp.sp350refused('SELECT count(*) FROM public.season_objectives','42501'), '3 anon is refused');
RESET ROLE;

-- 4. Switched off, the coach still reads the plan but changes nothing.
DELETE FROM public.academy_features WHERE organization_id = pg_temp.sp350id(100) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp350actor(10);
SELECT pg_temp.sp350check(pg_temp.sp350count('SELECT count(*) FROM public.season_plans') = 2
  AND pg_temp.sp350count('SELECT count(*) FROM public.season_objectives') = 2, '4 switched off, the coach still reads both plans');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format('UPDATE public.season_plans SET ends_on = ''2027-04-30'' WHERE id = %L',pg_temp.sp350plan())) = 0
  AND pg_temp.sp350changed(format('DELETE FROM public.season_objectives WHERE plan_id = %L',pg_temp.sp350plan())) = 0
  AND pg_temp.sp350refused(format('INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,3,''Late'')',pg_temp.sp350plan()),'42501'),
  '4 switched off, the coach changes, deletes and adds nothing');
RESET ROLE;

-- 5. Once shared (TRAK-356 will set it), an objective is never deleted.
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.sp350id(100),'season_plan');
UPDATE public.season_plans SET shared_at = now() WHERE id = pg_temp.sp350plan();
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp350actor(10);
SELECT pg_temp.sp350check(pg_temp.sp350changed(format('DELETE FROM public.season_objectives WHERE plan_id = %L',pg_temp.sp350plan())) = 0,
  '5 a shared plan''s objectives are never deleted');
SELECT pg_temp.sp350check(pg_temp.sp350changed(format(
  'UPDATE public.season_objectives SET looks_like = ''Everyone knows their job.'' WHERE plan_id = %L AND place = 2',pg_temp.sp350plan())) = 1,
  '5 a shared plan''s objective can still be reworded');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.sp350_results;
 IF total <> 30 THEN RAISE EXCEPTION 'Season plans: % checks ran; expected 30', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.sp350_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Season plans checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Season plans: % of % passed', total, total;
END $$;
ROLLBACK;

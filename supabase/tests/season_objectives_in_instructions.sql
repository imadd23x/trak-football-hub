-- @trak-suite mode=--objectives-in-instructions in-all=true
-- TRAK-363 (Season plan 15/18, spec TRAK-348): a match plan's instruction may carry a season objective, and only one
-- from the coach's own plan for that match's squad. Another squad's, another coach's or a made-up id is refused. Old
-- plans without ids stay valid, the words stay editable with the link kept, and an objective removed since stays
-- saveable on a plan that already carries it. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing objectives-in-instructions fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.oi363id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93630000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE oi363_results(label text, ok boolean);
GRANT SELECT, INSERT ON oi363_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.oi363actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.oi363id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.oi363check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.oi363_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.oi363refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.oi363changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- One instruction, as a goals array, carrying objective n (or none).
CREATE FUNCTION pg_temp.oi363goals(title text, objective integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_array(CASE WHEN objective IS NULL THEN jsonb_build_object('title', title, 'looks_like', '')
   ELSE jsonb_build_object('title', title, 'looks_like', '', 'season_objective_id', pg_temp.oi363id(objective)) END)
$$;
CREATE FUNCTION pg_temp.oi363save(match integer, goals jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('INSERT INTO public.game_plans(event_id,goals) VALUES(%L,%L) ON CONFLICT (event_id) DO UPDATE SET goals = excluded.goals', pg_temp.oi363id(match), goals)
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- One academy with games and the season plan. Coach One (10) coaches U16 and U14; Coach Two (11) coaches U16.
-- Coach One's matches: 500 (U16), 501 (U14); Coach Two's: 502 (U16). Plans: Coach One's U16 (50: objectives 60, 61),
-- U14 (51: objective 62); Coach Two's U16 (52: objective 63).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.oi363id(n),'synthetic-'||n||'@instructions363.invalid',now() FROM unnest(ARRAY[1,10,11]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.oi363id(1),'club','Synthetic Admin'),(pg_temp.oi363id(10),'coach','Synthetic Coach One'),(pg_temp.oi363id(11),'coach','Synthetic Coach Two');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES (pg_temp.oi363id(100),pg_temp.oi363id(1),'Instructions Academy','I363N1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES (pg_temp.oi363id(10),pg_temp.oi363id(100)),(pg_temp.oi363id(11),pg_temp.oi363id(100));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group) VALUES
 (pg_temp.oi363id(40),pg_temp.oi363id(10),'Synthetic Player Pat','U16'),(pg_temp.oi363id(41),pg_temp.oi363id(10),'Synthetic Player Uri','U14'),
 (pg_temp.oi363id(42),pg_temp.oi363id(11),'Synthetic Player Rae','U16');
INSERT INTO public.academy_features(organization_id,feature) VALUES (pg_temp.oi363id(100),'games'),(pg_temp.oi363id(100),'season_plan');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,squad) VALUES
 (pg_temp.oi363id(500),pg_temp.oi363id(10),'vs Synthetic United','match','Synthetic United','2054-11-07 15:00+00','19:00',true,'U16'),
 (pg_temp.oi363id(501),pg_temp.oi363id(10),'vs Synthetic Juniors','match','Synthetic Juniors','2054-11-07 15:00+00','19:00',true,'U14'),
 (pg_temp.oi363id(502),pg_temp.oi363id(11),'vs Synthetic Rovers','match','Synthetic Rovers','2054-11-07 15:00+00','19:00',true,'U16');
INSERT INTO public.season_plans(id,coach_user_id,squad,starts_on,ends_on,shared_at,last_shared_at) VALUES
 (pg_temp.oi363id(50),pg_temp.oi363id(10),'U16','2054-09-01','2055-06-30',now(),now()),
 (pg_temp.oi363id(51),pg_temp.oi363id(10),'U14','2054-09-01','2055-06-30',now(),now()),
 (pg_temp.oi363id(52),pg_temp.oi363id(11),'U16','2054-09-01','2055-06-30',now(),now());
INSERT INTO public.season_objectives(id,plan_id,place,title) VALUES
 (pg_temp.oi363id(60),pg_temp.oi363id(50),1,'Win it back within 5 seconds'),(pg_temp.oi363id(61),pg_temp.oi363id(50),2,'Stay compact'),
 (pg_temp.oi363id(62),pg_temp.oi363id(51),1,'Play through the middle'),(pg_temp.oi363id(63),pg_temp.oi363id(52),1,'Own the set pieces');

SET LOCAL ROLE authenticated;
SELECT pg_temp.oi363actor(10);

-- 1. The coach links an instruction to their own squad's objective, edits the words, and keeps the link.
SELECT pg_temp.oi363check(pg_temp.oi363changed(pg_temp.oi363save(500, pg_temp.oi363goals('Win it back within 5 seconds', 60))) = 1,
  '1 an instruction carries the squad''s season objective');
SELECT pg_temp.oi363check(pg_temp.oi363changed(pg_temp.oi363save(500, pg_temp.oi363goals('Win it back within 5 seconds, all of us', 60))) = 1
  AND (SELECT goals->0->>'season_objective_id' FROM public.game_plans WHERE event_id = pg_temp.oi363id(500)) = pg_temp.oi363id(60)::text,
  '1 the words change and the link stays');
SELECT pg_temp.oi363check(pg_temp.oi363changed(pg_temp.oi363save(500, pg_temp.oi363goals('Typed by the coach'))) = 1
  AND pg_temp.oi363changed(pg_temp.oi363save(500, jsonb_build_array(jsonb_build_object('title','Press as one','looks_like','','season_objective_id',NULL)))) = 1,
  '1 a typed instruction, or one with no objective, saves as before');

-- 2. Only the coach's own plan for this match's squad.
SELECT pg_temp.oi363check(pg_temp.oi363refused(pg_temp.oi363save(500, pg_temp.oi363goals('Play through the middle', 62)),'22023'),
  '2 another squad''s objective is refused');
SELECT pg_temp.oi363check(pg_temp.oi363refused(pg_temp.oi363save(500, pg_temp.oi363goals('Own the set pieces', 63)),'22023'),
  '2 another coach''s objective is refused');
SELECT pg_temp.oi363check(pg_temp.oi363refused(pg_temp.oi363save(500, pg_temp.oi363goals('Made up', 99)),'22023'),
  '2 a made-up objective is refused');
SELECT pg_temp.oi363check(pg_temp.oi363refused(pg_temp.oi363save(500, jsonb_build_array(jsonb_build_object('title','Bad','looks_like','','season_objective_id','not-a-uuid'))),'23514')
  AND pg_temp.oi363refused(pg_temp.oi363save(500, jsonb_build_array(jsonb_build_object('title','Bad','looks_like','','season_objective_id',7))),'23514')
  AND pg_temp.oi363refused(pg_temp.oi363save(500, jsonb_build_array(jsonb_build_object('title','Bad','looks_like','','objective',pg_temp.oi363id(60)))),'23514'),
  '2 an id that isn''t one, or a stray key, is refused');
SELECT pg_temp.oi363check(pg_temp.oi363changed(pg_temp.oi363save(501, pg_temp.oi363goals('Play through the middle', 62))) = 1,
  '2 the U14 match takes the U14 objective');

-- 3. An objective removed since stays saveable where it's already carried.
SELECT pg_temp.oi363changed(pg_temp.oi363save(500, pg_temp.oi363goals('Stay compact', 61)));
UPDATE public.season_objectives SET status = 'retired' WHERE id = pg_temp.oi363id(61);
SELECT pg_temp.oi363check(pg_temp.oi363changed(pg_temp.oi363save(500, pg_temp.oi363goals('Stay compact, always', 61))) = 1,
  '3 a removed objective''s match plan still saves, so its matches keep counting');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.oi363_results;
 IF total <> 9 THEN RAISE EXCEPTION 'Objectives in instructions: % checks ran; expected 9', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.oi363_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Objectives in instructions checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Objectives in instructions: % of % passed', total, total;
END $$;
ROLLBACK;

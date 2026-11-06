-- @trak-suite mode=--watch-first in-all=true
-- TRAK-355 (Season plan 7/18, spec TRAK-348): watch first. A coach watches consented players instead of setting them
-- up now, through watch_players() only, with the season_plan switch on; watching again restarts the clock. A player
-- with objectives is set up, so isn't watched, and giving one objectives ends the watch. The squad's reminder rule
-- sits on its season plan. Only the player's coach reads a watch. Other coaches, other academies, admins, players,
-- guardians and anon write and read nothing. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing watch-first fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.wf355id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93550000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE wf355_results(label text, ok boolean);
GRANT SELECT, INSERT ON wf355_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.wf355actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.wf355id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.wf355check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.wf355_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.wf355refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.wf355count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
CREATE FUNCTION pg_temp.wf355changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- Watching, as SQL text, for the refusal checks.
CREATE FUNCTION pg_temp.wf355watch(VARIADIC ns integer[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('SELECT public.watch_players(%L::uuid[])', (SELECT array_agg(pg_temp.wf355id(n)) FROM unnest(ns) n))
$$;
-- Who is watched, as one line of fixture numbers, for whoever calls it. RESET ROLE first to read as the owner.
CREATE FUNCTION pg_temp.wf355watched() RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(right(squad_player_id::text, 2), ',' ORDER BY squad_player_id), '') FROM public.player_watches
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Coach One (10) and Coach Two (11) coach in On;
-- Coach Three (12) in Off. Admin On (1) runs On. Coach One has a U16 plan (50); Coach Two has a U16 plan too (51).
-- Coach One's U16: Pat (squad 40, child 20, consent from guardian Gina 30, a Defender), Quinn (41, child 21, guardian
-- Gus 31 hasn't consented), Rae (42, on the roster with no account yet), Ola (44, adult 23, no position yet), Dev (45,
-- adult 24, whose coach has left). Coach Two's U16: Nia (46, adult 25). Coach Three's Sam (43, adult 22) is in the
-- academy that's off.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.wf355id(n),'synthetic-'||n||'@watch355.invalid',now() FROM unnest(ARRAY[1,10,11,12,20,21,22,23,24,25,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.wf355id(1),'club','Synthetic Admin On'),
 (pg_temp.wf355id(10),'coach','Synthetic Coach One'),(pg_temp.wf355id(11),'coach','Synthetic Coach Two'),
 (pg_temp.wf355id(12),'coach','Synthetic Coach Three'),
 (pg_temp.wf355id(20),'player','Synthetic Player Pat'),(pg_temp.wf355id(21),'player','Synthetic Player Quinn'),
 (pg_temp.wf355id(22),'player','Synthetic Player Sam'),(pg_temp.wf355id(23),'player','Synthetic Player Ola'),
 (pg_temp.wf355id(24),'player','Synthetic Player Dev'),(pg_temp.wf355id(25),'player','Synthetic Player Nia'),
 (pg_temp.wf355id(30),'parent','Synthetic Guardian Gina'),(pg_temp.wf355id(31),'parent','Synthetic Guardian Gus');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.wf355id(100),pg_temp.wf355id(1),'Watch On Academy','W355N1'),
 (pg_temp.wf355id(101),pg_temp.wf355id(1),'Watch Off Academy','W355F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.wf355id(10),pg_temp.wf355id(100)),(pg_temp.wf355id(11),pg_temp.wf355id(100)),(pg_temp.wf355id(12),pg_temp.wf355id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.wf355id(20),current_date - interval '10 years'),(pg_temp.wf355id(21),current_date - interval '10 years'),
 (pg_temp.wf355id(22),current_date - interval '20 years'),(pg_temp.wf355id(23),current_date - interval '20 years'),
 (pg_temp.wf355id(24),current_date - interval '20 years'),(pg_temp.wf355id(25),current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.wf355id(20),pg_temp.wf355id(30)),(pg_temp.wf355id(21),pg_temp.wf355id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.wf355id(40),pg_temp.wf355id(10),'Synthetic Player Pat','U16',pg_temp.wf355id(20),'Defender'),
 (pg_temp.wf355id(41),pg_temp.wf355id(10),'Synthetic Player Quinn','U16',pg_temp.wf355id(21),NULL),
 (pg_temp.wf355id(42),pg_temp.wf355id(10),'Synthetic Player Rae','U16',NULL,NULL),
 (pg_temp.wf355id(43),pg_temp.wf355id(12),'Synthetic Player Sam','U16',pg_temp.wf355id(22),NULL),
 (pg_temp.wf355id(44),pg_temp.wf355id(10),'Synthetic Player Ola','U16',pg_temp.wf355id(23),NULL),
 (pg_temp.wf355id(45),pg_temp.wf355id(10),'Synthetic Player Dev','U16',pg_temp.wf355id(24),NULL),
 (pg_temp.wf355id(46),pg_temp.wf355id(11),'Synthetic Player Nia','U16',pg_temp.wf355id(25),NULL);
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.wf355id(45);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.wf355id(100),'season_plan');
INSERT INTO public.season_plans(id,coach_user_id,squad) VALUES (pg_temp.wf355id(50),pg_temp.wf355id(10),'U16'),(pg_temp.wf355id(51),pg_temp.wf355id(11),'U16');

-- Consent through the guardian's own function, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.wf355actor(30);
SELECT public.record_parental_consent(pg_temp.wf355id(20), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
RESET ROLE;

-- 1. The coach watches consented players, placed or not; watching again restarts the clock.
SET LOCAL ROLE authenticated;
SELECT pg_temp.wf355actor(10);
SELECT pg_temp.wf355check(public.watch_players(ARRAY[pg_temp.wf355id(40), pg_temp.wf355id(44)]) = 2 AND pg_temp.wf355watched() = '40,44',
  '1 the coach watches Pat and Ola, and reads both');
SELECT pg_temp.wf355check(pg_temp.wf355count(format('SELECT count(*) FROM public.player_watches WHERE started_by = %L AND since > now() - interval ''1 minute''', pg_temp.wf355id(10))) = 2,
  '1 each watch keeps who began it and when');
RESET ROLE;
UPDATE public.player_watches SET since = now() - interval '20 days' WHERE squad_player_id = pg_temp.wf355id(44);
SET LOCAL ROLE authenticated;
SELECT pg_temp.wf355actor(10);
SELECT public.watch_players(ARRAY[pg_temp.wf355id(44)]);
SELECT pg_temp.wf355check(pg_temp.wf355count(format('SELECT count(*) FROM public.player_watches WHERE squad_player_id = %L AND since > now() - interval ''1 minute''', pg_temp.wf355id(44))) = 1,
  '1 keep watching restarts Ola''s clock');

-- 2. A player with objectives is set up: giving them ends the watch, and a set-up player isn't watched.
SELECT public.save_player_objectives(pg_temp.wf355id(40), '[{"title":"Wins their headers","source":"library"}]'::jsonb);
SELECT pg_temp.wf355check(pg_temp.wf355watched() = '44', '2 giving Pat an objective ends the watch');
SELECT pg_temp.wf355check(public.watch_players(ARRAY[pg_temp.wf355id(40)]) = 0 AND pg_temp.wf355watched() = '44',
  '2 a player with objectives isn''t watched');
SELECT public.save_player_objectives(pg_temp.wf355id(40), '[]'::jsonb);
SELECT public.watch_players(ARRAY[pg_temp.wf355id(40)]);
SELECT public.save_player_objectives(pg_temp.wf355id(40), '[]'::jsonb);
SELECT pg_temp.wf355check(pg_temp.wf355watched() = '40,44', '2 saving no objectives leaves the watch running');

-- 3. A child waiting for consent isn't watched, and one refusal saves nothing.
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(41), '42501') AND pg_temp.wf355refused(pg_temp.wf355watch(42), '42501'),
  '3 a child waiting for a guardian, or with no account yet, isn''t watched');
RESET ROLE;
DELETE FROM public.player_watches WHERE squad_player_id = pg_temp.wf355id(44);
SET LOCAL ROLE authenticated;
SELECT pg_temp.wf355actor(10);
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(44, 41), '42501') AND pg_temp.wf355watched() = '40',
  '3 watching everyone stops at one who can''t be watched, and watches no one');

-- 4. Not the coach's player: another academy, a squad they've left, a made-up id, another coach.
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(43), '42501') AND pg_temp.wf355refused(pg_temp.wf355watch(45), '42501')
  AND pg_temp.wf355refused(pg_temp.wf355watch(99), '42501') AND pg_temp.wf355refused(pg_temp.wf355watch(46), '42501'),
  '4 the coach can''t watch another academy''s player, one from a squad they''ve left, a made-up one, or another coach''s');
SELECT pg_temp.wf355actor(11);
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(40), '42501') AND pg_temp.wf355watched() = '',
  '4 another coach in the academy watches none of Coach One''s players and reads none of their watches');
SELECT pg_temp.wf355actor(12);
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(43), '42501'),
  '4 with the switch off in their academy, a coach can''t watch their own player');

-- 5. Admins, players and guardians watch and read nothing; anon can't even ask.
SELECT pg_temp.wf355actor(1);
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(40), '42501') AND pg_temp.wf355watched() = '', '5 the academy admin watches and reads nothing');
SELECT pg_temp.wf355actor(20);
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(40), '42501') AND pg_temp.wf355watched() = '', '5 the player can''t watch or see they''re watched');
SELECT pg_temp.wf355actor(30);
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(40), '42501') AND pg_temp.wf355watched() = '', '5 the guardian watches and reads nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(40), '42501') AND pg_temp.wf355refused('SELECT count(*) FROM public.player_watches', '42501'),
  '5 anon can''t call it or read a watch');
RESET ROLE;

-- 6. No way round the function.
SET LOCAL ROLE authenticated;
SELECT pg_temp.wf355actor(10);
SELECT pg_temp.wf355check(pg_temp.wf355refused(format('INSERT INTO public.player_watches(squad_player_id) VALUES(%L)', pg_temp.wf355id(44)), '42501')
  AND pg_temp.wf355refused('UPDATE public.player_watches SET since = now()', '42501')
  AND pg_temp.wf355refused('DELETE FROM public.player_watches', '42501'), '6 nobody writes, moves or deletes a watch directly');

-- 7. The squad's reminder rule lives on its plan: the coach picks one of the five; nobody else changes it.
SELECT pg_temp.wf355check(pg_temp.wf355count('SELECT count(*) FROM public.season_plans WHERE watch_rule = ''t2''') = 1, '7 a plan starts with "after 2 trainings"');
SELECT pg_temp.wf355check(pg_temp.wf355changed(format('UPDATE public.season_plans SET watch_rule = ''w4'' WHERE id = %L', pg_temp.wf355id(50))) = 1,
  '7 the coach picks "after 4 weeks"');
SELECT pg_temp.wf355check(pg_temp.wf355refused(format('UPDATE public.season_plans SET watch_rule = ''w3'' WHERE id = %L', pg_temp.wf355id(50)), '23514'),
  '7 anything but the five is refused');
SELECT pg_temp.wf355actor(11);
SELECT pg_temp.wf355check(pg_temp.wf355changed(format('UPDATE public.season_plans SET watch_rule = ''t4'' WHERE id = %L', pg_temp.wf355id(50))) = 0,
  '7 another coach can''t change it');
RESET ROLE;

-- 8. Switched off, the coach watches no one and can't change the rule, but still reads who is watched.
DELETE FROM public.academy_features WHERE organization_id = pg_temp.wf355id(100) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.wf355actor(10);
SELECT pg_temp.wf355check(pg_temp.wf355refused(pg_temp.wf355watch(44), '42501')
  AND pg_temp.wf355changed(format('UPDATE public.season_plans SET watch_rule = ''t4'' WHERE id = %L', pg_temp.wf355id(50))) = 0,
  '8 switched off, the coach watches no one and the rule stays');
SELECT pg_temp.wf355check(pg_temp.wf355watched() = '40', '8 switched off, the coach still reads who is watched');
RESET ROLE;
SELECT pg_temp.wf355check((SELECT watch_rule FROM public.season_plans WHERE id = pg_temp.wf355id(50)) = 'w4', '8 the refusals changed nothing');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.wf355_results;
 IF total <> 23 THEN RAISE EXCEPTION 'Watch first: % checks ran; expected 23', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.wf355_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Watch first checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Watch first: % of % passed', total, total;
END $$;
ROLLBACK;

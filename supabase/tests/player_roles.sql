-- @trak-suite mode=--player-roles in-all=true
-- TRAK-353 (Season plan 5/18, spec TRAK-348): a coach saves a consented child's main position, up to two Can also
-- play positions and any roles in one go, through save_player_position_and_roles() only, with the season_plan switch
-- on. Only the player's coach reads them. A third Can also play is refused, the main position can't also be one, and
-- a role is one trimmed line of up to 60 characters. Moving a player's main position onto one they could also play
-- drops it from Can also play, from either function. Other coaches, other academies, admins, players, guardians and
-- anon save nothing and read nothing. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing player-roles fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.pr353id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93530000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE pr353_results(label text, ok boolean);
GRANT SELECT, INSERT ON pr353_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.pr353actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.pr353id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.pr353check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.pr353_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.pr353refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.pr353count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
-- What one player holds, as one line each, for whoever calls it. RESET ROLE first to read as the database owner.
CREATE FUNCTION pg_temp.pr353pos(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT position FROM public.squad_players WHERE id = pg_temp.pr353id(n)
$$;
CREATE FUNCTION pg_temp.pr353also(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(position, ',' ORDER BY position), '') FROM public.squad_player_also_plays WHERE squad_player_id = pg_temp.pr353id(n)
$$;
CREATE FUNCTION pg_temp.pr353roles(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(role, ',' ORDER BY role), '') FROM public.squad_player_roles WHERE squad_player_id = pg_temp.pr353id(n)
$$;
CREATE FUNCTION pg_temp.pr353history(n integer) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.squad_position_history WHERE squad_player_id = pg_temp.pr353id(n)
$$;
-- One save, as SQL text, for the refusal checks.
CREATE FUNCTION pg_temp.pr353save(n integer, pos text, also text, roles text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('SELECT public.save_player_position_and_roles(%L,%s,%s,%s)', pg_temp.pr353id(n),
   coalesce(quote_literal(pos), 'NULL'), coalesce(also, 'NULL'), coalesce(roles, 'NULL'))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Coach One (10) and Coach Two (11) coach in On;
-- Coach Three (12) in Off. Admin On (1) runs On.
-- Coach One's U16: Pat (squad 40, child 20, consent from guardian Gina 30), Quinn (41, child 21, guardian Gus 31
-- hasn't consented), Rae (42, on the roster with no account yet, so waiting), Ola (44, adult 23, a Defender), Dev
-- (45, adult 24, whose coach has left). Coach Three's Sam (43, adult 22) is in the academy that's off.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.pr353id(n),'synthetic-'||n||'@roles353.invalid',now() FROM unnest(ARRAY[1,10,11,12,20,21,22,23,24,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.pr353id(1),'club','Synthetic Admin On'),
 (pg_temp.pr353id(10),'coach','Synthetic Coach One'),(pg_temp.pr353id(11),'coach','Synthetic Coach Two'),
 (pg_temp.pr353id(12),'coach','Synthetic Coach Three'),
 (pg_temp.pr353id(20),'player','Synthetic Player Pat'),(pg_temp.pr353id(21),'player','Synthetic Player Quinn'),
 (pg_temp.pr353id(22),'player','Synthetic Player Sam'),(pg_temp.pr353id(23),'player','Synthetic Player Ola'),
 (pg_temp.pr353id(24),'player','Synthetic Player Dev'),
 (pg_temp.pr353id(30),'parent','Synthetic Guardian Gina'),(pg_temp.pr353id(31),'parent','Synthetic Guardian Gus');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.pr353id(100),pg_temp.pr353id(1),'Roles On Academy','R353N1'),
 (pg_temp.pr353id(101),pg_temp.pr353id(1),'Roles Off Academy','R353F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.pr353id(10),pg_temp.pr353id(100)),(pg_temp.pr353id(11),pg_temp.pr353id(100)),(pg_temp.pr353id(12),pg_temp.pr353id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.pr353id(20),current_date - interval '10 years'),(pg_temp.pr353id(21),current_date - interval '10 years'),
 (pg_temp.pr353id(22),current_date - interval '20 years'),(pg_temp.pr353id(23),current_date - interval '20 years'),
 (pg_temp.pr353id(24),current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.pr353id(20),pg_temp.pr353id(30)),(pg_temp.pr353id(21),pg_temp.pr353id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.pr353id(40),pg_temp.pr353id(10),'Synthetic Player Pat','U16',pg_temp.pr353id(20),NULL),
 (pg_temp.pr353id(41),pg_temp.pr353id(10),'Synthetic Player Quinn','U16',pg_temp.pr353id(21),NULL),
 (pg_temp.pr353id(42),pg_temp.pr353id(10),'Synthetic Player Rae','U16',NULL,NULL),
 (pg_temp.pr353id(43),pg_temp.pr353id(12),'Synthetic Player Sam','U16',pg_temp.pr353id(22),'Attacker'),
 (pg_temp.pr353id(44),pg_temp.pr353id(10),'Synthetic Player Ola','U16',pg_temp.pr353id(23),'Defender'),
 (pg_temp.pr353id(45),pg_temp.pr353id(10),'Synthetic Player Dev','U16',pg_temp.pr353id(24),'Midfielder');
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.pr353id(45);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.pr353id(100),'season_plan');

-- Consent through the guardian's own function, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.pr353actor(30);
SELECT public.record_parental_consent(pg_temp.pr353id(20), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
RESET ROLE;

-- 1. The coach saves a consented child's position, Can also play and roles in one go, and changes them.
SET LOCAL ROLE authenticated;
SELECT pg_temp.pr353actor(10);
SELECT public.save_player_position_and_roles(pg_temp.pr353id(40),'Defender',ARRAY['Midfielder'],ARRAY['Stopper','Win the second ball']);
SELECT pg_temp.pr353check(pg_temp.pr353pos(40) = 'Defender' AND pg_temp.pr353also(40) = 'Midfielder'
  AND pg_temp.pr353roles(40) = 'Stopper,Win the second ball', '1 the coach reads back Pat''s position, Can also play and two roles');
SELECT pg_temp.pr353check(pg_temp.pr353history(40) = 1, '1 placing Pat for the first time is kept in the history');
SELECT public.save_player_position_and_roles(pg_temp.pr353id(40),'Defender',ARRAY['Midfielder'],ARRAY['Stopper','Win the second ball']);
SELECT pg_temp.pr353check(pg_temp.pr353history(40) = 1 AND pg_temp.pr353also(40) = 'Midfielder' AND pg_temp.pr353roles(40) = 'Stopper,Win the second ball',
  '1 saving the same again changes nothing and writes no history');
SELECT public.save_player_position_and_roles(pg_temp.pr353id(40),'Defender',ARRAY['Attacker','Midfielder'],ARRAY['Stopper']);
SELECT pg_temp.pr353check(pg_temp.pr353also(40) = 'Attacker,Midfielder' AND pg_temp.pr353roles(40) = 'Stopper',
  '1 a second Can also play is added and an unpicked role goes');
SELECT public.save_player_position_and_roles(pg_temp.pr353id(44),'Defender',ARRAY[]::text[],ARRAY['Win the second ball']);
SELECT pg_temp.pr353check(pg_temp.pr353count('SELECT count(DISTINCT role) FROM public.squad_player_roles') = 2
  AND pg_temp.pr353count('SELECT count(*) FROM public.squad_player_roles WHERE role = ''Win the second ball''') = 1,
  '1 the coach reads every role across their players, so their own role shows for the next one');
SELECT pg_temp.pr353check(pg_temp.pr353history(44) = 0, '1 keeping a listed position writes no history');

-- 2. Up to two Can also play, never the main position, only the four positions.
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','ARRAY[''Attacker'',''Midfielder'',''Goalkeeper'']','ARRAY[''Stopper'']'),'22023'),
  '2 a third Can also play is refused');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','ARRAY[''Defender'']','ARRAY[''Stopper'']'),'22023'),
  '2 the main position can''t also be a Can also play');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','ARRAY[''Midfield'']','NULL'),'22023')
  AND pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','ARRAY[''midfielder'']','NULL'),'22023')
  AND pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','ARRAY[NULL]::text[]','NULL'),'22023')
  AND pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','ARRAY[''Attacker'',''Attacker'']','NULL'),'22023'),
  '2 a made-up, lower-case, blank or repeated Can also play is refused');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,NULL,'NULL','NULL'),'22023')
  AND pg_temp.pr353refused(pg_temp.pr353save(40,'CM','NULL','NULL'),'22023'),
  '2 a save needs one of the four main positions');

-- 3. A role is one trimmed line of 1 to 60 characters, each once, up to 30 a player.
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','NULL','ARRAY['''']'),'22023')
  AND pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','NULL','ARRAY['' Stopper'']'),'22023')
  AND pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','NULL','ARRAY[NULL]::text[]'),'22023')
  AND pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','NULL',format('ARRAY[%L]',repeat('x',61))),'22023'),
  '3 a blank, padded, missing or 61-character role is refused');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','NULL','ARRAY[''Runner'',''runner'']'),'22023'),
  '3 the same role twice, in any case, is refused');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Defender','NULL',
  '(SELECT array_agg(''Role '' || n) FROM generate_series(1,31) n)'),'22023'),
  '3 a 31st role is refused');
SELECT pg_temp.pr353check(pg_temp.pr353also(40) = 'Attacker,Midfielder' AND pg_temp.pr353roles(40) = 'Stopper' AND pg_temp.pr353pos(40) = 'Defender',
  '3 every refused save left Pat as they were');

-- 4. A new main position leaves Can also play, from either function, and the move is kept.
SELECT public.save_player_position_and_roles(pg_temp.pr353id(40),'Midfielder',ARRAY['Attacker'],ARRAY['Stopper']);
SELECT pg_temp.pr353check(pg_temp.pr353pos(40) = 'Midfielder' AND pg_temp.pr353also(40) = 'Attacker' AND pg_temp.pr353history(40) = 2,
  '4 moving Pat to midfield from the panel saves the move and its history');
SELECT public.set_player_position(pg_temp.pr353id(40),'Attacker');
SELECT pg_temp.pr353check(pg_temp.pr353pos(40) = 'Attacker' AND pg_temp.pr353also(40) = '' AND pg_temp.pr353history(40) = 3,
  '4 a Positions tap onto a Can also play drops it from Can also play');
SELECT public.save_player_position_and_roles(pg_temp.pr353id(44),'Defender',NULL,NULL);
SELECT pg_temp.pr353check(pg_temp.pr353also(44) = '' AND pg_temp.pr353roles(44) = '', '4 no lists means none');

-- 5. A child waiting for consent gets nothing saved.
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(41,'Defender','ARRAY[''Midfielder'']','ARRAY[''Stopper'']'),'42501'),
  '5 a child whose guardian hasn''t consented gets nothing');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(42,'Defender','ARRAY[''Midfielder'']','ARRAY[''Stopper'']'),'42501'),
  '5 a child on the roster with no account yet gets nothing');

-- 6. Not the coach's player: another academy, a squad they've left, a made-up id, another coach.
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(43,'Attacker','NULL','ARRAY[''Runner'']'),'42501'),
  '6 the coach saves nothing for another academy''s player');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(45,'Midfielder','NULL','ARRAY[''Runner'']'),'42501'),
  '6 the coach saves nothing for a squad they''ve left');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(99,'Midfielder','NULL','ARRAY[''Runner'']'),'42501'),
  '6 a made-up player is refused the same way');
SELECT pg_temp.pr353actor(11);
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Attacker','NULL','ARRAY[''Runner'']'),'42501')
  AND pg_temp.pr353count('SELECT count(*) FROM public.squad_player_roles') = 0
  AND pg_temp.pr353count('SELECT count(*) FROM public.squad_player_also_plays') = 0,
  '6 another coach in the academy saves nothing and reads nothing');
SELECT pg_temp.pr353actor(12);
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Attacker','NULL','ARRAY[''Runner'']'),'42501')
  AND pg_temp.pr353count('SELECT count(*) FROM public.squad_player_roles') = 0,
  '6 a coach in another academy saves nothing and reads nothing');
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(43,'Attacker','NULL','ARRAY[''Runner'']'),'42501'),
  '6 with the switch off in their academy, a coach saves nothing for their own player');

-- 7. Admins, players and guardians save nothing and read nothing; anon can't even ask.
SELECT pg_temp.pr353actor(1);
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Attacker','NULL','ARRAY[''Runner'']'),'42501')
  AND pg_temp.pr353count('SELECT count(*) FROM public.squad_player_roles') = 0, '7 the academy admin saves nothing and reads nothing');
SELECT pg_temp.pr353actor(20);
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Attacker','NULL','ARRAY[''Runner'']'),'42501')
  AND pg_temp.pr353count('SELECT count(*) FROM public.squad_player_roles') = 0, '7 the player saves nothing and reads nothing');
SELECT pg_temp.pr353actor(30);
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Attacker','NULL','ARRAY[''Runner'']'),'42501')
  AND pg_temp.pr353count('SELECT count(*) FROM public.squad_player_also_plays') = 0, '7 the guardian saves nothing and reads nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Attacker','NULL','ARRAY[''Runner'']'),'42501')
  AND pg_temp.pr353refused('SELECT count(*) FROM public.squad_player_roles','42501')
  AND pg_temp.pr353refused('SELECT count(*) FROM public.squad_player_also_plays','42501'), '7 anon can''t call it or read either list');
RESET ROLE;

-- 8. No way round the function: neither list takes a direct write.
SET LOCAL ROLE authenticated;
SELECT pg_temp.pr353actor(10);
SELECT pg_temp.pr353check(pg_temp.pr353refused(format('INSERT INTO public.squad_player_also_plays(squad_player_id,position) VALUES(%L,''Goalkeeper'')',pg_temp.pr353id(40)),'42501')
  AND pg_temp.pr353refused('UPDATE public.squad_player_also_plays SET position = ''Goalkeeper''','42501')
  AND pg_temp.pr353refused('DELETE FROM public.squad_player_also_plays','42501'), '8 nobody writes, rewrites or deletes Can also play directly');
SELECT pg_temp.pr353check(pg_temp.pr353refused(format('INSERT INTO public.squad_player_roles(squad_player_id,role) VALUES(%L,''Runner'')',pg_temp.pr353id(40)),'42501')
  AND pg_temp.pr353refused('UPDATE public.squad_player_roles SET role = ''Runner''','42501')
  AND pg_temp.pr353refused('DELETE FROM public.squad_player_roles','42501'), '8 nobody writes, rewrites or deletes a role directly');
RESET ROLE;
SELECT pg_temp.pr353check(pg_temp.pr353pos(40) = 'Attacker' AND pg_temp.pr353also(40) = '' AND pg_temp.pr353roles(40) = 'Stopper'
  AND pg_temp.pr353pos(41) IS NULL AND pg_temp.pr353pos(42) IS NULL AND pg_temp.pr353also(41) = '' AND pg_temp.pr353roles(42) = ''
  AND pg_temp.pr353pos(43) = 'Attacker' AND pg_temp.pr353roles(43) = '' AND pg_temp.pr353pos(45) = 'Midfielder' AND pg_temp.pr353roles(45) = '',
  '8 every refusal left the players as they were');

-- 9. Switched off, the coach saves nothing but still reads what's there.
DELETE FROM public.academy_features WHERE organization_id = pg_temp.pr353id(100) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.pr353actor(10);
SELECT pg_temp.pr353check(pg_temp.pr353refused(pg_temp.pr353save(40,'Attacker','NULL','ARRAY[''Runner'']'),'42501'),
  '9 switched off, the coach saves nothing');
SELECT pg_temp.pr353check(pg_temp.pr353roles(40) = 'Stopper', '9 switched off, the coach still reads Pat''s role');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.pr353_results;
 IF total <> 34 THEN RAISE EXCEPTION 'Player roles: % checks ran; expected 34', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.pr353_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Player roles checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Player roles: % of % passed', total, total;
END $$;
ROLLBACK;

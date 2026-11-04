-- @trak-suite mode=--player-positions in-all=true
-- TRAK-352 (Season plan 4/18, spec TRAK-348): a coach places a consented child on their own squad, with the
-- season_plan switch on, through set_player_position() only. Every change keeps a history row (from, to, who,
-- when), and only the player's coach reads it. Other coaches, other academies, admins, players, guardians and anon
-- can't place anyone. A child waiting for consent can't be placed, an invalid value is refused, and a direct update
-- of the column is refused for app roles. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing player-positions fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.pp352id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93520000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE pp352_results(label text, ok boolean);
GRANT SELECT, INSERT ON pp352_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.pp352actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.pp352id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.pp352check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.pp352_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.pp352refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.pp352changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE FUNCTION pg_temp.pp352count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
-- A row's position and its history, read as the database owner, whatever the caller may see.
CREATE FUNCTION pg_temp.pp352pos(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT position FROM public.squad_players WHERE id = pg_temp.pp352id(n)
$$;
CREATE FUNCTION pg_temp.pp352history(n integer) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.squad_position_history WHERE squad_player_id = pg_temp.pp352id(n)
$$;
-- Each SELECT pp352pos/pp352history runs as the role that calls it; RESET ROLE first to read as the owner.

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Coach One (10) and Coach Two (11) coach in On;
-- Coach Three (12) in Off. Admin On (1) runs On.
-- Coach One's U16: Pat (squad 40, child 20, consent from guardian Gina 30), Quinn (41, child 21, guardian Gus 31
-- hasn't consented), Rae (42, on the roster with no account yet, so waiting), Ola (44, adult 23, already a
-- Defender), Dev (45, adult 24, whose coach has left). Coach Three's Sam (43, adult 22) is in the academy that's off.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.pp352id(n),'synthetic-'||n||'@positions352.invalid',now() FROM unnest(ARRAY[1,10,11,12,20,21,22,23,24,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.pp352id(1),'club','Synthetic Admin On'),
 (pg_temp.pp352id(10),'coach','Synthetic Coach One'),(pg_temp.pp352id(11),'coach','Synthetic Coach Two'),
 (pg_temp.pp352id(12),'coach','Synthetic Coach Three'),
 (pg_temp.pp352id(20),'player','Synthetic Player Pat'),(pg_temp.pp352id(21),'player','Synthetic Player Quinn'),
 (pg_temp.pp352id(22),'player','Synthetic Player Sam'),(pg_temp.pp352id(23),'player','Synthetic Player Ola'),
 (pg_temp.pp352id(24),'player','Synthetic Player Dev'),
 (pg_temp.pp352id(30),'parent','Synthetic Guardian Gina'),(pg_temp.pp352id(31),'parent','Synthetic Guardian Gus');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.pp352id(100),pg_temp.pp352id(1),'Positions On Academy','P352N1'),
 (pg_temp.pp352id(101),pg_temp.pp352id(1),'Positions Off Academy','P352F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.pp352id(10),pg_temp.pp352id(100)),(pg_temp.pp352id(11),pg_temp.pp352id(100)),(pg_temp.pp352id(12),pg_temp.pp352id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.pp352id(20),current_date - interval '10 years'),(pg_temp.pp352id(21),current_date - interval '10 years'),
 (pg_temp.pp352id(22),current_date - interval '20 years'),(pg_temp.pp352id(23),current_date - interval '20 years'),
 (pg_temp.pp352id(24),current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.pp352id(20),pg_temp.pp352id(30)),(pg_temp.pp352id(21),pg_temp.pp352id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.pp352id(40),pg_temp.pp352id(10),'Synthetic Player Pat','U16',pg_temp.pp352id(20),NULL),
 (pg_temp.pp352id(41),pg_temp.pp352id(10),'Synthetic Player Quinn','U16',pg_temp.pp352id(21),NULL),
 (pg_temp.pp352id(42),pg_temp.pp352id(10),'Synthetic Player Rae','U16',NULL,NULL),
 (pg_temp.pp352id(43),pg_temp.pp352id(12),'Synthetic Player Sam','U16',pg_temp.pp352id(22),NULL),
 (pg_temp.pp352id(44),pg_temp.pp352id(10),'Synthetic Player Ola','U16',pg_temp.pp352id(23),'Defender'),
 (pg_temp.pp352id(45),pg_temp.pp352id(10),'Synthetic Player Dev','U16',pg_temp.pp352id(24),NULL);
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.pp352id(45);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.pp352id(100),'season_plan');

-- Consent through the guardian's own function, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.pp352actor(30);
SELECT public.record_parental_consent(pg_temp.pp352id(20), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
RESET ROLE;

-- 1. The coach places a consented child on their own squad, and changes it; each change is kept.
SET LOCAL ROLE authenticated;
SELECT pg_temp.pp352actor(10);
SELECT pg_temp.pp352check(public.set_player_position(pg_temp.pp352id(40),'Goalkeeper') = 'Goalkeeper',
  '1 the coach places Pat as a goalkeeper');
SELECT pg_temp.pp352check(pg_temp.pp352count(format('SELECT count(*) FROM public.squad_players WHERE id = %L AND position = ''Goalkeeper''',pg_temp.pp352id(40))) = 1,
  '1 the roster row now says Goalkeeper');
SELECT pg_temp.pp352check(public.set_player_position(pg_temp.pp352id(40),'Defender') = 'Defender',
  '1 the coach moves Pat to defence');
SELECT pg_temp.pp352check(public.set_player_position(pg_temp.pp352id(40),'Defender') = 'Defender',
  '1 placing Pat where they already are is accepted');
SELECT pg_temp.pp352check(public.set_player_position(pg_temp.pp352id(44),'Attacker') = 'Attacker',
  '1 an adult already listed as a defender moves to attack');
SELECT pg_temp.pp352check(pg_temp.pp352count(format(
  'SELECT count(*) FROM public.squad_position_history WHERE squad_player_id = %L',pg_temp.pp352id(40))) = 2,
  '1 the coach reads Pat''s two changes, and the repeat wrote none');
SELECT pg_temp.pp352check(pg_temp.pp352count(format(
  'SELECT count(*) FROM public.squad_position_history WHERE squad_player_id = %L AND from_position IS NULL AND to_position = ''Goalkeeper'' AND changed_by = %L',
  pg_temp.pp352id(40),pg_temp.pp352id(10))) = 1, '1 the first change is from nothing to Goalkeeper, by the coach');
SELECT pg_temp.pp352check(pg_temp.pp352count(format(
  'SELECT count(*) FROM public.squad_position_history WHERE squad_player_id = %L AND from_position = ''Goalkeeper'' AND to_position = ''Defender''',
  pg_temp.pp352id(40))) = 1, '1 the second change is from Goalkeeper to Defender');
SELECT pg_temp.pp352check(pg_temp.pp352count(format(
  'SELECT count(*) FROM public.squad_position_history WHERE squad_player_id = %L AND from_position = ''Defender'' AND to_position = ''Attacker''',
  pg_temp.pp352id(44))) = 1, '1 a listed position is kept as the change''s starting point');

-- 2. Only the four positions; nothing else, and no blank.
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Midfield'')',pg_temp.pp352id(40)),'22023')
  AND pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''CM'')',pg_temp.pp352id(40)),'22023')
  AND pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''goalkeeper'')',pg_temp.pp352id(40)),'22023')
  AND pg_temp.pp352refused(format('SELECT public.set_player_position(%L,NULL)',pg_temp.pp352id(40)),'22023')
  AND pg_temp.pp352refused(format('SELECT public.set_player_position(%L,'''')',pg_temp.pp352id(40)),'22023'),
  '2 anything but the four positions is refused');

-- 3. A child waiting for consent isn't placed.
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Midfielder'')',pg_temp.pp352id(41)),'42501'),
  '3 a child whose guardian hasn''t consented isn''t placed');
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Midfielder'')',pg_temp.pp352id(42)),'42501'),
  '3 a child on the roster with no account yet isn''t placed');

-- 4. Not the coach's player: another coach, another academy, a coach who has left, a made-up id.
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(43)),'42501'),
  '4 the coach can''t place another academy''s player');
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(45)),'42501'),
  '4 the coach can''t place a player from a squad they''ve left');
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(99)),'42501'),
  '4 a made-up player is refused the same way');
SELECT pg_temp.pp352actor(11);
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(40)),'42501')
  AND pg_temp.pp352count('SELECT count(*) FROM public.squad_position_history') = 0,
  '4 another coach in the academy places no one and reads no history');
SELECT pg_temp.pp352actor(12);
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(40)),'42501')
  AND pg_temp.pp352count('SELECT count(*) FROM public.squad_position_history') = 0,
  '4 a coach in another academy places no one and reads no history');
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(43)),'42501'),
  '4 with the switch off in their academy, a coach can''t place their own player');

-- 5. Admins, players and guardians place no one and read no history; anon can't even ask.
SELECT pg_temp.pp352actor(1);
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(40)),'42501')
  AND pg_temp.pp352count('SELECT count(*) FROM public.squad_position_history') = 0, '5 the academy admin places no one and reads nothing');
SELECT pg_temp.pp352actor(20);
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(40)),'42501')
  AND pg_temp.pp352count('SELECT count(*) FROM public.squad_position_history') = 0, '5 the player can''t place themselves or read the history');
SELECT pg_temp.pp352actor(30);
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(40)),'42501')
  AND pg_temp.pp352count('SELECT count(*) FROM public.squad_position_history') = 0, '5 the guardian places no one and reads nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Attacker'')',pg_temp.pp352id(40)),'42501')
  AND pg_temp.pp352refused('SELECT count(*) FROM public.squad_position_history','42501'), '5 anon can''t call it or read the history');
RESET ROLE;

-- 6. No way round the function: the column and the history refuse direct writes; other columns still change.
SET LOCAL ROLE authenticated;
SELECT pg_temp.pp352actor(10);
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('UPDATE public.squad_players SET position = ''Midfielder'' WHERE id = %L',pg_temp.pp352id(40)),'42501'),
  '6 the coach can''t write the position straight into the roster row');
SELECT pg_temp.pp352check(pg_temp.pp352changed(format('UPDATE public.squad_players SET shirt_number = 7 WHERE id = %L',pg_temp.pp352id(40))) = 1,
  '6 the coach still changes the row''s other columns');
SELECT pg_temp.pp352check(pg_temp.pp352refused(format(
  'INSERT INTO public.squad_position_history(squad_player_id,to_position) VALUES(%L,''Attacker'')',pg_temp.pp352id(40)),'42501')
  AND pg_temp.pp352refused('UPDATE public.squad_position_history SET to_position = ''Attacker''','42501')
  AND pg_temp.pp352refused('DELETE FROM public.squad_position_history','42501'), '6 nobody writes, rewrites or deletes the history');
RESET ROLE;
SELECT pg_temp.pp352check(pg_temp.pp352pos(40) = 'Defender' AND pg_temp.pp352pos(41) IS NULL AND pg_temp.pp352pos(42) IS NULL
  AND pg_temp.pp352pos(43) IS NULL AND pg_temp.pp352pos(45) IS NULL AND pg_temp.pp352history(40) = 2 AND pg_temp.pp352history(41) = 0,
  '6 every refusal left the roster and the history as they were');

-- 7. The set-up's first question is kept on the plan: Yes, Some of them or Not yet.
SET LOCAL ROLE authenticated;
SELECT pg_temp.pp352actor(10);
SELECT pg_temp.pp352check(pg_temp.pp352changed('INSERT INTO public.season_plans(squad,positions_known) VALUES(''U16'',''not_yet'')') = 1,
  '7 Not yet saves with nobody placed');
SELECT pg_temp.pp352check(pg_temp.pp352changed('UPDATE public.season_plans SET positions_known = ''some'' WHERE squad = ''U16''') = 1,
  '7 the coach changes the answer to Some of them');
SELECT pg_temp.pp352check(pg_temp.pp352refused('UPDATE public.season_plans SET positions_known = ''maybe'' WHERE squad = ''U16''','23514'),
  '7 any other answer is refused');
RESET ROLE;

-- 8. Switched off, the coach places no one but still reads the history.
DELETE FROM public.academy_features WHERE organization_id = pg_temp.pp352id(100) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.pp352actor(10);
SELECT pg_temp.pp352check(pg_temp.pp352refused(format('SELECT public.set_player_position(%L,''Midfielder'')',pg_temp.pp352id(40)),'42501'),
  '8 switched off, the coach places no one');
SELECT pg_temp.pp352check(pg_temp.pp352count('SELECT count(*) FROM public.squad_position_history') = 3,
  '8 switched off, the coach still reads every change');
RESET ROLE;
SELECT pg_temp.pp352check(pg_temp.pp352pos(40) = 'Defender', '8 the refusal changed nothing');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.pp352_results;
 IF total <> 32 THEN RAISE EXCEPTION 'Player positions: % checks ran; expected 32', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.pp352_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Player positions checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Player positions: % of % passed', total, total;
END $$;
ROLLBACK;

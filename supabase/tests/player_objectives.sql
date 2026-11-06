-- @trak-suite mode=--player-objectives in-all=true
-- TRAK-354 (Season plan 6/18, spec TRAK-348): a coach gives a consented, placed child up to two open objectives,
-- from their position's six or the coach's own, through save_player_objectives() only, with the season_plan switch
-- on. A library objective can name the season objective it supports, from the coach's plan for that squad. No
-- position, no objective. Removing one deletes it while the plan is a draft and retires it once shared. Only the
-- player's coach reads them. Other coaches, other academies, admins, players, guardians and anon save nothing and
-- read nothing. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing player-objectives fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.po354id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93540000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE po354_results(label text, ok boolean);
GRANT SELECT, INSERT ON po354_results TO authenticated, anon, service_role;
CREATE TEMP TABLE po354_kept(id uuid);
GRANT SELECT, INSERT ON po354_kept TO authenticated;
CREATE FUNCTION pg_temp.po354actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.po354id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.po354check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.po354_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.po354refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.po354count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
-- A player's open objectives as one line, for whoever calls it. RESET ROLE first to read as the database owner.
CREATE FUNCTION pg_temp.po354open(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(title, ' | ' ORDER BY title), '') FROM public.player_objectives
 WHERE squad_player_id = pg_temp.po354id(n) AND status = 'open'
$$;
-- One save, as SQL text, for the refusal checks.
CREATE FUNCTION pg_temp.po354save(n integer, objectives text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('SELECT public.save_player_objectives(%L,%L::jsonb)', pg_temp.po354id(n), objectives)
$$;
CREATE FUNCTION pg_temp.po354lib(title text, supports uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('title', title, 'source', 'library', 'season_objective_id', supports)
$$;
CREATE FUNCTION pg_temp.po354own(title text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('title', title, 'source', 'own')
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Coach One (10) and Coach Two (11) coach in On;
-- Coach Three (12) in Off. Admin On (1) runs On.
-- Coach One's U16: Pat (squad 40, child 20, consent from guardian Gina 30, a Defender), Quinn (41, child 21, guardian
-- Gus 31 hasn't consented), Rae (42, on the roster with no account yet), Ola (44, adult 23, no position yet), Dev
-- (45, adult 24, whose coach has left). Coach One's U14: Uri (46, adult 25). Coach Three's Sam (43, adult 22) is in
-- the academy that's off. Coach One's U16 plan has two season objectives (60, 61); their U14 plan has one (62); Coach
-- Two's U16 plan has one (63).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.po354id(n),'synthetic-'||n||'@objectives354.invalid',now() FROM unnest(ARRAY[1,10,11,12,20,21,22,23,24,25,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.po354id(1),'club','Synthetic Admin On'),
 (pg_temp.po354id(10),'coach','Synthetic Coach One'),(pg_temp.po354id(11),'coach','Synthetic Coach Two'),
 (pg_temp.po354id(12),'coach','Synthetic Coach Three'),
 (pg_temp.po354id(20),'player','Synthetic Player Pat'),(pg_temp.po354id(21),'player','Synthetic Player Quinn'),
 (pg_temp.po354id(22),'player','Synthetic Player Sam'),(pg_temp.po354id(23),'player','Synthetic Player Ola'),
 (pg_temp.po354id(24),'player','Synthetic Player Dev'),(pg_temp.po354id(25),'player','Synthetic Player Uri'),
 (pg_temp.po354id(30),'parent','Synthetic Guardian Gina'),(pg_temp.po354id(31),'parent','Synthetic Guardian Gus');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.po354id(100),pg_temp.po354id(1),'Objectives On Academy','O354N1'),
 (pg_temp.po354id(101),pg_temp.po354id(1),'Objectives Off Academy','O354F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.po354id(10),pg_temp.po354id(100)),(pg_temp.po354id(11),pg_temp.po354id(100)),(pg_temp.po354id(12),pg_temp.po354id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.po354id(20),current_date - interval '10 years'),(pg_temp.po354id(21),current_date - interval '10 years'),
 (pg_temp.po354id(22),current_date - interval '20 years'),(pg_temp.po354id(23),current_date - interval '20 years'),
 (pg_temp.po354id(24),current_date - interval '20 years'),(pg_temp.po354id(25),current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.po354id(20),pg_temp.po354id(30)),(pg_temp.po354id(21),pg_temp.po354id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.po354id(40),pg_temp.po354id(10),'Synthetic Player Pat','U16',pg_temp.po354id(20),'Defender'),
 (pg_temp.po354id(41),pg_temp.po354id(10),'Synthetic Player Quinn','U16',pg_temp.po354id(21),'Defender'),
 (pg_temp.po354id(42),pg_temp.po354id(10),'Synthetic Player Rae','U16',NULL,'Defender'),
 (pg_temp.po354id(43),pg_temp.po354id(12),'Synthetic Player Sam','U16',pg_temp.po354id(22),'Attacker'),
 (pg_temp.po354id(44),pg_temp.po354id(10),'Synthetic Player Ola','U16',pg_temp.po354id(23),NULL),
 (pg_temp.po354id(45),pg_temp.po354id(10),'Synthetic Player Dev','U16',pg_temp.po354id(24),'Midfielder'),
 (pg_temp.po354id(46),pg_temp.po354id(10),'Synthetic Player Uri','U14',pg_temp.po354id(25),'Midfielder');
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.po354id(45);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.po354id(100),'season_plan');
INSERT INTO public.season_plans(id,coach_user_id,squad) VALUES
 (pg_temp.po354id(50),pg_temp.po354id(10),'U16'),(pg_temp.po354id(51),pg_temp.po354id(10),'U14'),(pg_temp.po354id(52),pg_temp.po354id(11),'U16');
INSERT INTO public.season_objectives(id,plan_id,place,title) VALUES
 (pg_temp.po354id(60),pg_temp.po354id(50),1,'Win it back within 5 seconds'),(pg_temp.po354id(61),pg_temp.po354id(50),2,'Stay compact'),
 (pg_temp.po354id(62),pg_temp.po354id(51),1,'Win it back within 5 seconds'),(pg_temp.po354id(63),pg_temp.po354id(52),1,'Win it back within 5 seconds');

-- Consent through the guardian's own function, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.po354actor(30);
SELECT public.record_parental_consent(pg_temp.po354id(20), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
RESET ROLE;

-- 1. The coach gives a consented, placed child two objectives, one supporting a season objective, and changes them.
SET LOCAL ROLE authenticated;
SELECT pg_temp.po354actor(10);
SELECT public.save_player_objectives(pg_temp.po354id(40), jsonb_build_array(
  pg_temp.po354lib('Steps in to win it the moment we lose it', pg_temp.po354id(60)), pg_temp.po354lib('Defends 1v1 on the outside')));
SELECT pg_temp.po354check(pg_temp.po354open(40) = 'Defends 1v1 on the outside | Steps in to win it the moment we lose it',
  '1 the coach reads back Pat''s two objectives');
SELECT pg_temp.po354check(pg_temp.po354count(format(
  'SELECT count(*) FROM public.player_objectives WHERE squad_player_id = %L AND season_objective_id = %L AND source = ''library'' AND created_by = %L',
  pg_temp.po354id(40),pg_temp.po354id(60),pg_temp.po354id(10))) = 1, '1 one names the season objective it supports, and who set it');
INSERT INTO pg_temp.po354_kept SELECT id FROM public.player_objectives WHERE squad_player_id = pg_temp.po354id(40);
SELECT public.save_player_objectives(pg_temp.po354id(40), jsonb_build_array(
  pg_temp.po354lib('Steps in to win it the moment we lose it', pg_temp.po354id(60)), pg_temp.po354lib('Defends 1v1 on the outside')));
SELECT pg_temp.po354check(pg_temp.po354count('SELECT count(*) FROM public.player_objectives po JOIN pg_temp.po354_kept k USING (id)') = 2
  AND pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 2, '1 saving the same again keeps the same two');
SELECT public.save_player_objectives(pg_temp.po354id(40), jsonb_build_array(
  pg_temp.po354lib('Steps in to win it the moment we lose it', pg_temp.po354id(61)), pg_temp.po354own('Talks to the keeper at every corner')));
SELECT pg_temp.po354check(pg_temp.po354open(40) = 'Steps in to win it the moment we lose it | Talks to the keeper at every corner'
  AND pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 2,
  '1 swapping one for the coach''s own, in a draft plan, deletes the old one');
SELECT pg_temp.po354check(pg_temp.po354count(format(
  'SELECT count(*) FROM public.player_objectives WHERE season_objective_id = %L AND title = ''Steps in to win it the moment we lose it''',pg_temp.po354id(61))) = 1,
  '1 a kept objective can name another season objective');
SELECT public.save_player_objectives(pg_temp.po354id(40), '[]'::jsonb);
SELECT pg_temp.po354check(pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 0, '1 saving none deletes both while the plan is a draft');

-- 2. Up to two, each once, each a trimmed line of up to 120 characters, from the library or the coach.
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40,
  jsonb_build_array(pg_temp.po354own('One'), pg_temp.po354own('Two'), pg_temp.po354own('Three'))::text),'22023'),
  '2 a third objective is refused');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354own('Wins headers'), pg_temp.po354own('wins headers'))::text),'22023'),
  '2 the same objective twice, in any case, is refused');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354own(''))::text),'22023')
  AND pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354own(' Wins headers'))::text),'22023')
  AND pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354own(repeat('x',121)))::text),'22023')
  AND pg_temp.po354refused(pg_temp.po354save(40, '[{"title":"Wins headers","source":"ai"}]'),'22023')
  AND pg_temp.po354refused(pg_temp.po354save(40, '[{"source":"own"}]'),'22023')
  AND pg_temp.po354refused(pg_temp.po354save(40, '["Wins headers"]'),'22023')
  AND pg_temp.po354refused(pg_temp.po354save(40, '{"title":"Wins headers","source":"own"}'),'22023'),
  '2 a blank, padded, 121-character, unsourced, untitled or misshapen objective is refused');

-- 3. A supported season objective comes from the coach's own plan for that squad.
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354lib('Holds the line together', pg_temp.po354id(63)))::text),'22023'),
  '3 another coach''s season objective is refused');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354lib('Holds the line together', pg_temp.po354id(62)))::text),'22023'),
  '3 the coach''s season objective for another squad is refused');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, '[{"title":"Holds the line together","source":"library","season_objective_id":"not-an-id"}]'),'22023'),
  '3 a made-up season objective is refused');

-- 4. No position, no objective.
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(44, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'22023'),
  '4 a player with no position gets no objective');
SELECT public.save_player_objectives(pg_temp.po354id(44), '[]'::jsonb);
SELECT pg_temp.po354check(pg_temp.po354open(44) = '', '4 saving none for them is accepted and writes nothing');

-- 5. A child waiting for consent gets nothing.
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(41, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501'),
  '5 a child whose guardian hasn''t consented gets nothing');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(42, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501'),
  '5 a child on the roster with no account yet gets nothing');

-- 6. Not the coach's player: another academy, a squad they've left, a made-up id, another coach.
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(43, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501'),
  '6 the coach saves nothing for another academy''s player');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(45, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501'),
  '6 the coach saves nothing for a squad they''ve left');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(99, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501'),
  '6 a made-up player is refused the same way');
SELECT public.save_player_objectives(pg_temp.po354id(40), jsonb_build_array(pg_temp.po354lib('Holds the line together', pg_temp.po354id(61))));
SELECT pg_temp.po354actor(11);
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501')
  AND pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 0,
  '6 another coach in the academy saves nothing and reads nothing');
SELECT pg_temp.po354actor(12);
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501')
  AND pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 0,
  '6 a coach in another academy saves nothing and reads nothing');
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(43, jsonb_build_array(pg_temp.po354own('Runs in behind'))::text),'42501'),
  '6 with the switch off in their academy, a coach saves nothing for their own player');

-- 7. Admins, players and guardians save nothing and read nothing; anon can't even ask.
SELECT pg_temp.po354actor(1);
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, '[]'),'42501')
  AND pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 0, '7 the academy admin saves nothing and reads nothing');
SELECT pg_temp.po354actor(20);
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, '[]'),'42501')
  AND pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 0, '7 the player saves nothing and reads nothing yet');
SELECT pg_temp.po354actor(30);
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, '[]'),'42501')
  AND pg_temp.po354count('SELECT count(*) FROM public.player_objectives') = 0, '7 the guardian saves nothing and reads nothing yet');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, '[]'),'42501')
  AND pg_temp.po354refused('SELECT count(*) FROM public.player_objectives','42501'), '7 anon can''t call it or read them');
RESET ROLE;

-- 8. No way round the function, and never three open, even written straight in as the owner.
SET LOCAL ROLE authenticated;
SELECT pg_temp.po354actor(10);
SELECT pg_temp.po354check(pg_temp.po354refused(format(
  'INSERT INTO public.player_objectives(squad_player_id,slot,title,source) VALUES(%L,2,''Runs in behind'',''own'')',pg_temp.po354id(40)),'42501')
  AND pg_temp.po354refused('UPDATE public.player_objectives SET title = ''Runs in behind''','42501')
  AND pg_temp.po354refused('DELETE FROM public.player_objectives','42501'), '8 nobody writes, rewrites or deletes an objective directly');
RESET ROLE;
SELECT pg_temp.po354check(pg_temp.po354refused(format(
  'INSERT INTO public.player_objectives(squad_player_id,slot,title,source) SELECT squad_player_id,slot,''Runs in behind'',''own'' FROM public.player_objectives WHERE squad_player_id = %L',
  pg_temp.po354id(40)),'23505'), '8 a second open objective in the same place is refused, so two saves can''t race to three');
SELECT pg_temp.po354check(pg_temp.po354open(40) = 'Holds the line together' AND pg_temp.po354open(41) = '' AND pg_temp.po354open(42) = ''
  AND pg_temp.po354open(43) = '' AND pg_temp.po354open(45) = '', '8 every refusal left the players as they were');

-- 9. A deleted season objective leaves its player objectives, which no longer name it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.po354actor(10);
DELETE FROM public.season_objectives WHERE id = pg_temp.po354id(61);
SELECT pg_temp.po354check(pg_temp.po354open(40) = 'Holds the line together' AND pg_temp.po354count(format(
  'SELECT count(*) FROM public.player_objectives WHERE squad_player_id = %L AND season_objective_id IS NULL',pg_temp.po354id(40))) = 1,
  '9 deleting a season objective in the draft keeps the player''s objective, supporting nothing');
RESET ROLE;

-- 10. Once the plan is shared, a removed objective is retired, not deleted, and frees its place.
UPDATE public.season_plans SET shared_at = now() WHERE id = pg_temp.po354id(50);
SET LOCAL ROLE authenticated;
SELECT pg_temp.po354actor(10);
SELECT public.save_player_objectives(pg_temp.po354id(40), jsonb_build_array(pg_temp.po354own('Talks to the keeper at every corner'), pg_temp.po354own('Wins their headers')));
SELECT pg_temp.po354check(pg_temp.po354open(40) = 'Talks to the keeper at every corner | Wins their headers',
  '10 after sharing, the coach swaps in two new ones');
SELECT pg_temp.po354check(pg_temp.po354count(format(
  'SELECT count(*) FROM public.player_objectives WHERE squad_player_id = %L AND title = ''Holds the line together'' AND status = ''retired'' AND retired_at IS NOT NULL',
  pg_temp.po354id(40))) = 1, '10 the one they replaced is kept as retired, with its date');
RESET ROLE;

-- 11. Switched off, the coach saves nothing but still reads what's there.
DELETE FROM public.academy_features WHERE organization_id = pg_temp.po354id(100) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.po354actor(10);
SELECT pg_temp.po354check(pg_temp.po354refused(pg_temp.po354save(40, '[]'),'42501'), '11 switched off, the coach saves nothing');
SELECT pg_temp.po354check(pg_temp.po354open(40) = 'Talks to the keeper at every corner | Wins their headers', '11 switched off, the coach still reads them');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.po354_results;
 IF total <> 34 THEN RAISE EXCEPTION 'Player objectives: % checks ran; expected 34', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.po354_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Player objectives checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Player objectives: % of % passed', total, total;
END $$;
ROLLBACK;

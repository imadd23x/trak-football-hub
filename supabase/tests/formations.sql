-- @trak-suite mode=--formations in-all=true
-- TRAK-357 (Season plan 9/18, spec TRAK-348): Squad › Formations, the coach's saved line-ups per squad. A coach saves
-- a formation (a name, a format, a shape from Matches' rule, and starters in its places) through save_formation()
-- only, with the season_plan switch on; renames and edits it; deletes it with delete_formation(), which changes
-- nothing else. Each starter is a consented player in that squad, once. start_formations() saves a squad's first
-- three once, never twice. Only the formation's coach reads it. Other coaches, other academies, admins, players,
-- guardians and anon read and write nothing. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing formations fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.fm357id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93570000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE fm357_results(label text, ok boolean);
GRANT SELECT, INSERT ON fm357_results TO authenticated, anon, service_role;
CREATE TEMP TABLE fm357_ids(name text, id uuid);
GRANT SELECT, INSERT ON fm357_ids TO authenticated;
CREATE FUNCTION pg_temp.fm357actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.fm357id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.fm357check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.fm357_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.fm357refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.fm357count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
-- Starters as the app sends them: a list of {slot, squad_player_id}, from (slot, fixture number) pairs.
CREATE FUNCTION pg_temp.fm357xi(VARIADIC pairs integer[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('slot', pairs[i], 'squad_player_id', pg_temp.fm357id(pairs[i + 1])) ORDER BY i), '[]'::jsonb)
 FROM generate_series(1, array_length(pairs, 1), 2) i
$$;
-- One save, as SQL text, for the refusal checks.
CREATE FUNCTION pg_temp.fm357save(id uuid, squad text, name text, format integer, shape text, starters jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('SELECT public.save_formation(%s,%L,%L,%s::smallint,%L,%L::jsonb)',
   coalesce(quote_literal(id::text) || '::uuid', 'NULL'), squad, name, format, shape, starters)
$$;
-- A formation's starters as one line, slot:fixture number, for whoever calls it.
CREATE FUNCTION pg_temp.fm357line(f uuid) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(fp.slot || ':' || right(fp.squad_player_id::text, 2), ' ' ORDER BY fp.slot), '')
 FROM public.formation_players fp WHERE fp.formation_id = f
$$;
CREATE FUNCTION pg_temp.fm357get(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM pg_temp.fm357_ids WHERE name = n $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Coach One (10) and Coach Two (11) coach in On;
-- Coach Three (12) in Off. Admin On (1) runs On.
-- Coach One's U16: Pat (squad 40, child 20, consent from guardian Gina 30), Quinn (41, child 21, guardian Gus 31
-- hasn't consented), Rae (42, on the roster with no account yet), and adults Ola (44), Kim (47), Lee (48), Max (49);
-- Dev (45, adult, whose coach has left). Coach One's U14: Uri (46, adult). Coach Three's Sam (43, adult) is in the
-- academy that's off. Coach Two coaches a U16 too: Nia (50, adult).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.fm357id(n),'synthetic-'||n||'@formations357.invalid',now() FROM unnest(ARRAY[1,10,11,12,20,21,22,23,24,25,26,27,28,29,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.fm357id(1),'club','Synthetic Admin On'),
 (pg_temp.fm357id(10),'coach','Synthetic Coach One'),(pg_temp.fm357id(11),'coach','Synthetic Coach Two'),
 (pg_temp.fm357id(12),'coach','Synthetic Coach Three'),
 (pg_temp.fm357id(20),'player','Synthetic Player Pat'),(pg_temp.fm357id(21),'player','Synthetic Player Quinn'),
 (pg_temp.fm357id(22),'player','Synthetic Player Sam'),(pg_temp.fm357id(23),'player','Synthetic Player Ola'),
 (pg_temp.fm357id(24),'player','Synthetic Player Dev'),(pg_temp.fm357id(25),'player','Synthetic Player Uri'),
 (pg_temp.fm357id(27),'player','Synthetic Player Kim'),(pg_temp.fm357id(28),'player','Synthetic Player Lee'),
 (pg_temp.fm357id(29),'player','Synthetic Player Max'),(pg_temp.fm357id(26),'player','Synthetic Player Nia'),
 (pg_temp.fm357id(30),'parent','Synthetic Guardian Gina'),(pg_temp.fm357id(31),'parent','Synthetic Guardian Gus');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.fm357id(100),pg_temp.fm357id(1),'Formations On Academy','F357N1'),
 (pg_temp.fm357id(101),pg_temp.fm357id(1),'Formations Off Academy','F357F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.fm357id(10),pg_temp.fm357id(100)),(pg_temp.fm357id(11),pg_temp.fm357id(100)),(pg_temp.fm357id(12),pg_temp.fm357id(101));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.fm357id(n), current_date - interval '20 years' FROM unnest(ARRAY[22,23,24,25,26,27,28,29]) n;
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.fm357id(20),current_date - interval '10 years'),(pg_temp.fm357id(21),current_date - interval '10 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.fm357id(20),pg_temp.fm357id(30)),(pg_temp.fm357id(21),pg_temp.fm357id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.fm357id(40),pg_temp.fm357id(10),'Synthetic Player Pat','U16',pg_temp.fm357id(20),'Goalkeeper'),
 (pg_temp.fm357id(41),pg_temp.fm357id(10),'Synthetic Player Quinn','U16',pg_temp.fm357id(21),'Defender'),
 (pg_temp.fm357id(42),pg_temp.fm357id(10),'Synthetic Player Rae','U16',NULL,'Defender'),
 (pg_temp.fm357id(43),pg_temp.fm357id(12),'Synthetic Player Sam','U16',pg_temp.fm357id(22),'Attacker'),
 (pg_temp.fm357id(44),pg_temp.fm357id(10),'Synthetic Player Ola','U16',pg_temp.fm357id(23),'Defender'),
 (pg_temp.fm357id(45),pg_temp.fm357id(10),'Synthetic Player Dev','U16',pg_temp.fm357id(24),'Midfielder'),
 (pg_temp.fm357id(46),pg_temp.fm357id(10),'Synthetic Player Uri','U14',pg_temp.fm357id(25),'Midfielder'),
 (pg_temp.fm357id(47),pg_temp.fm357id(10),'Synthetic Player Kim','U16',pg_temp.fm357id(27),'Defender'),
 (pg_temp.fm357id(48),pg_temp.fm357id(10),'Synthetic Player Lee','U16',pg_temp.fm357id(28),'Attacker'),
 (pg_temp.fm357id(49),pg_temp.fm357id(10),'Synthetic Player Max','U16',pg_temp.fm357id(29),'Attacker'),
 (pg_temp.fm357id(50),pg_temp.fm357id(11),'Synthetic Player Nia','U16',pg_temp.fm357id(26),'Midfielder');
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.fm357id(45);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.fm357id(100),'season_plan');

-- Consent through the guardian's own function, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.fm357actor(30);
SELECT public.record_parental_consent(pg_temp.fm357id(20), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
RESET ROLE;

-- 1. The coach saves a formation for their squad, then renames it, changes its shape and swaps players.
SET LOCAL ROLE authenticated;
SELECT pg_temp.fm357actor(10);
INSERT INTO pg_temp.fm357_ids SELECT 'press', public.save_formation(NULL, 'U16', 'Press high', 5::smallint, '2-2', pg_temp.fm357xi(1,40, 2,44, 3,47, 4,48, 5,49));
SELECT pg_temp.fm357check(pg_temp.fm357count(format('SELECT count(*) FROM public.formations WHERE id = %L AND squad = ''U16'' AND name = ''Press high'' AND format = 5 AND shape = ''2-2'' AND coach_user_id = %L',
  pg_temp.fm357get('press'), pg_temp.fm357id(10))) = 1 AND pg_temp.fm357line(pg_temp.fm357get('press')) = '1:40 2:44 3:47 4:48 5:49',
  '1 the coach reads back the formation and its five starters');
SELECT public.save_formation(pg_temp.fm357get('press'), 'U16', 'Sit deep', 5::smallint, '1-2-1', pg_temp.fm357xi(1,40, 2,47, 3,44, 5,49));
SELECT pg_temp.fm357check(pg_temp.fm357count(format('SELECT count(*) FROM public.formations WHERE id = %L AND name = ''Sit deep'' AND shape = ''1-2-1''', pg_temp.fm357get('press'))) = 1
  AND pg_temp.fm357line(pg_temp.fm357get('press')) = '1:40 2:47 3:44 5:49', '1 renamed, reshaped and swapped, with a place left empty');
INSERT INTO pg_temp.fm357_ids SELECT 'eleven', public.save_formation(NULL, 'U16', 'Balanced', 11::smallint, '4-3-3', pg_temp.fm357xi(1,40, 2,44));
SELECT pg_temp.fm357check(pg_temp.fm357count('SELECT count(*) FROM public.formations') = 2
  AND pg_temp.fm357line(pg_temp.fm357get('eleven')) = '1:40 2:44', '1 a second formation keeps its own starters, the same players included');

-- 2. A name once per squad; a name, a format and a shape that fits it.
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'sit DEEP', 5, '2-2', '[]'), '23505'),
  '2 the same name twice in a squad, in any case, is refused');
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', '', 5, '2-2', '[]'), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', ' Padded', 5, '2-2', '[]'), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', repeat('x', 33), 5, '2-2', '[]'), '22023'),
  '2 a blank, padded or 33-character name is refused');
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Six', 6, '3-2', '[]'), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Wrong shape', 5, '4-4-2', '[]'), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'No shape', 11, 'diamond', '[]'), '22023'),
  '2 a format that isn''t 11, 9, 7 or 5, or a shape that doesn''t fit it, is refused');

-- 3. Each starter once, in one of the shape's places.
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Too far', 5, '2-2', pg_temp.fm357xi(6,44)), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Nowhere', 5, '2-2', pg_temp.fm357xi(0,44)), '22023'),
  '3 a place the format doesn''t have is refused');
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Twice', 5, '2-2', pg_temp.fm357xi(2,44, 3,44)), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Crowded', 5, '2-2', pg_temp.fm357xi(2,44, 2,47)), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Shapeless', 5, '2-2', '[{"slot":2}]'), '22023')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Not a list', 5, '2-2', '{"slot":2}'), '22023'),
  '3 a player twice, two in one place, or a misshapen starter is refused');

-- 4. A starter is a consented player in this squad, still the coach's.
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Waiting', 5, '2-2', pg_temp.fm357xi(2,41)), '42501')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'No account', 5, '2-2', pg_temp.fm357xi(2,42)), '42501'),
  '4 a child waiting for consent can''t start');
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Left', 5, '2-2', pg_temp.fm357xi(3,45)), '42501')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Other squad', 5, '2-2', pg_temp.fm357xi(3,46)), '42501')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Other academy', 5, '2-2', pg_temp.fm357xi(3,43)), '42501')
  AND pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Made up', 5, '2-2', pg_temp.fm357xi(3,99)), '42501'),
  '4 a player from a squad they''ve left, another squad, another academy or nowhere can''t start');
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U99', 'Nobody''s', 5, '2-2', '[]'), '42501'),
  '4 the coach saves nothing for a squad they don''t coach');

-- 5. Delete takes the formation and its starters, and nothing else.
INSERT INTO pg_temp.fm357_ids SELECT 'spare', public.save_formation(NULL, 'U16', 'Spare', 5::smallint, '2-2', pg_temp.fm357xi(1,40, 4,48));
SELECT public.delete_formation(pg_temp.fm357get('spare'));
SELECT pg_temp.fm357check(pg_temp.fm357count('SELECT count(*) FROM public.formations') = 2
  AND pg_temp.fm357line(pg_temp.fm357get('press')) = '1:40 2:47 3:44 5:49' AND pg_temp.fm357line(pg_temp.fm357get('eleven')) = '1:40 2:44',
  '5 deleting one leaves the others and their starters as they were');
RESET ROLE;
SELECT pg_temp.fm357check(pg_temp.fm357count(format('SELECT count(*) FROM public.formation_players WHERE formation_id = %L', pg_temp.fm357get('spare'))) = 0,
  '5 the deleted formation''s starters went with it');

-- 6. The first three are saved once per squad, never twice, and all or nothing.
SET LOCAL ROLE authenticated;
SELECT pg_temp.fm357actor(10);
SELECT pg_temp.fm357check(pg_temp.fm357refused(format('SELECT public.start_formations(''U16'', %L::jsonb)', jsonb_build_array(
  jsonb_build_object('name','Attacking tactic','format',5,'shape','2-2','starters',pg_temp.fm357xi(1,40)),
  jsonb_build_object('name','Park the bus','format',5,'shape','2-2','starters',pg_temp.fm357xi(1,41)))), '42501')
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 2, '6 a bad first three saves none of them, and the squad can start again');
SELECT pg_temp.fm357check(public.start_formations('U16', jsonb_build_array(
  jsonb_build_object('name','Attacking tactic','format',11,'shape','3-4-3','starters',pg_temp.fm357xi(1,40, 2,44)),
  jsonb_build_object('name','Park the bus','format',11,'shape','5-4-1','starters',pg_temp.fm357xi(1,40)),
  jsonb_build_object('name','Counter','format',11,'shape','4-4-2','starters','[]'::jsonb))) = true
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 5, '6 the first three are saved for the squad');
SELECT pg_temp.fm357check(public.start_formations('U16', jsonb_build_array(
  jsonb_build_object('name','Again','format',11,'shape','4-4-2','starters','[]'::jsonb))) = false
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 5, '6 a second start saves nothing');
DO $$ BEGIN PERFORM public.delete_formation(id) FROM public.formations; END $$;
SELECT pg_temp.fm357check(public.start_formations('U16', jsonb_build_array(
  jsonb_build_object('name','Again','format',11,'shape','4-4-2','starters','[]'::jsonb))) = false
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 0, '6 with every formation deleted, the three never come back');
SELECT pg_temp.fm357check(pg_temp.fm357refused(format('SELECT public.start_formations(''U16'', %L::jsonb)', (
  SELECT jsonb_agg(jsonb_build_object('name','F' || n,'format',5,'shape','2-2','starters','[]'::jsonb)) FROM generate_series(1,4) n)), '22023'),
  '6 more than three to start with is refused');
INSERT INTO pg_temp.fm357_ids SELECT 'kept', public.save_formation(NULL, 'U16', 'Kept', 5::smallint, '2-2', pg_temp.fm357xi(1,40, 2,44));

-- 7. Another coach, another academy, a switched-off academy: nothing.
SELECT pg_temp.fm357actor(11);
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(pg_temp.fm357get('kept'), 'U16', 'Taken', 5, '2-2', '[]'), '42501')
  AND pg_temp.fm357refused(format('SELECT public.delete_formation(%L)', pg_temp.fm357get('kept')), '42501')
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 0 AND pg_temp.fm357count('SELECT count(*) FROM public.formation_players') = 0,
  '7 another coach with a U16 of their own can''t change, delete or read it');
SELECT pg_temp.fm357actor(12);
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Mine', 5, '2-2', pg_temp.fm357xi(5,43)), '42501')
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 0,
  '7 with the switch off in their academy, a coach saves nothing for their own squad, and reads no one else''s');

-- 8. Admins, players and guardians read and write nothing; anon can't even ask.
SELECT pg_temp.fm357actor(1);
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Admin', 5, '2-2', '[]'), '42501')
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 0, '8 the academy admin saves and reads nothing');
SELECT pg_temp.fm357actor(20);
SELECT pg_temp.fm357check(pg_temp.fm357refused(format('SELECT public.delete_formation(%L)', pg_temp.fm357get('kept')), '42501')
  AND pg_temp.fm357count('SELECT count(*) FROM public.formation_players') = 0, '8 the player changes and reads nothing');
SELECT pg_temp.fm357actor(30);
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Guardian', 5, '2-2', '[]'), '42501')
  AND pg_temp.fm357count('SELECT count(*) FROM public.formations') = 0, '8 the guardian saves and reads nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(NULL, 'U16', 'Anon', 5, '2-2', '[]'), '42501')
  AND pg_temp.fm357refused('SELECT count(*) FROM public.formations', '42501')
  AND pg_temp.fm357refused('SELECT count(*) FROM public.formation_players', '42501'), '8 anon can''t call it or read either table');
RESET ROLE;

-- 9. No way round the functions.
SET LOCAL ROLE authenticated;
SELECT pg_temp.fm357actor(10);
SELECT pg_temp.fm357check(pg_temp.fm357refused('INSERT INTO public.formations(coach_user_id,squad,name,format,shape) VALUES(auth.uid(),''U16'',''Direct'',5,''2-2'')', '42501')
  AND pg_temp.fm357refused('UPDATE public.formations SET name = ''Direct''', '42501')
  AND pg_temp.fm357refused('DELETE FROM public.formations', '42501'), '9 nobody writes, rewrites or deletes a formation directly');
SELECT pg_temp.fm357check(pg_temp.fm357refused(format('INSERT INTO public.formation_players(formation_id,slot,squad_player_id) VALUES(%L,3,%L)', pg_temp.fm357get('kept'), pg_temp.fm357id(47)), '42501')
  AND pg_temp.fm357refused('UPDATE public.formation_players SET slot = 4', '42501')
  AND pg_temp.fm357refused('DELETE FROM public.formation_players', '42501'), '9 nobody writes, moves or removes a starter directly');
SELECT pg_temp.fm357check(pg_temp.fm357line(pg_temp.fm357get('kept')) = '1:40 2:44', '9 every refusal left the formation as it was');

-- 10. Switched off, the coach saves nothing but still reads their formations.
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.fm357id(100) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.fm357actor(10);
SELECT pg_temp.fm357check(pg_temp.fm357refused(pg_temp.fm357save(pg_temp.fm357get('kept'), 'U16', 'Off', 5, '2-2', '[]'), '42501')
  AND pg_temp.fm357refused(format('SELECT public.delete_formation(%L)', pg_temp.fm357get('kept')), '42501'),
  '10 switched off, the coach saves and deletes nothing');
SELECT pg_temp.fm357check(pg_temp.fm357line(pg_temp.fm357get('kept')) = '1:40 2:44', '10 switched off, the coach still reads it');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.fm357_results;
 IF total <> 29 THEN RAISE EXCEPTION 'Formations: % checks ran; expected 29', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.fm357_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Formations checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Formations: % of % passed', total, total;
END $$;
ROLLBACK;

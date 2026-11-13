-- @trak-suite mode=--formations-into-matches in-all=true
-- TRAK-360 (Season plan 12/18, spec TRAK-348): a formation goes into a match's Game plan as a copy, or loads as the
-- squad's default for a format. A copy writes the shape and the starters; later edits to the formation never reach the
-- match; the match keeps its instructions and each player's job. A family-reported starter goes to Not attending; a
-- starter who left the roster or whose consent isn't in place is skipped. One default per format. Deleting a formation
-- changes no match. Only the match's coach; the season_plan and games switches; not after kick-off or when cancelled.
-- Test people are named after footballers. Synthetic fixtures; rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing formations-into-matches fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.f360id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93600000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE f360_results(label text, ok boolean);
GRANT SELECT, INSERT ON f360_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.f360actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f360id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.f360check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.f360_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.f360refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- A match's line-up as one line, "player:role:slot job" by player, e.g. "40:starter:2".
CREATE FUNCTION pg_temp.f360line(event integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(right(squad_player_id::text, 2) || ':' || role || ':' || coalesce(slot::text, '-'), ' ' ORDER BY squad_player_id), '')
 FROM public.game_plan_players WHERE event_id = pg_temp.f360id(event)
$$;
CREATE FUNCTION pg_temp.f360use(formation integer, VARIADIC events integer[]) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.use_formation_for_matches(%L, ARRAY[%s]::uuid[])', pg_temp.f360id(formation),
   (SELECT string_agg(quote_literal(pg_temp.f360id(e)::text), ',') FROM unnest(events) e))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has Games and the season plan. Otto Rehhagel (10) coaches its U16 and Fernando Santos (11) too.
-- Otto's roster: Theodoros Zagorakis (40, A), Angelos Charisteas (41, B), Antonios Nikopolidis (45, keeper) and Kostas
-- Katsouranis (48), all consented; Giorgos Karagounis (42), consent pending; Stelios Giannakopoulos (43), departed.
-- Fernando's: Giourkas Seitaridis (46). Matches: 500 and 501 fresh, 502 with a saved line-up and instructions, 503,
-- 507, 508, 510 fresh for the default, 504 kicked off, 505 cancelled, 506 Fernando's.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.f360id(n),'synthetic-'||n||'@formations360.invalid',now()
 FROM unnest(ARRAY[1,10,11,20,21,22,23,25,26,28,30,31,35,36,38]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.f360id(1),'club','Vassilis Tsiartas'),
 (pg_temp.f360id(10),'coach','Otto Rehhagel'),(pg_temp.f360id(11),'coach','Fernando Santos'),
 (pg_temp.f360id(20),'player','Theodoros Zagorakis'),(pg_temp.f360id(21),'player','Angelos Charisteas'),
 (pg_temp.f360id(22),'player','Giorgos Karagounis'),(pg_temp.f360id(23),'player','Stelios Giannakopoulos'),
 (pg_temp.f360id(25),'player','Antonios Nikopolidis'),(pg_temp.f360id(26),'player','Giourkas Seitaridis'),
 (pg_temp.f360id(28),'player','Kostas Katsouranis'),
 (pg_temp.f360id(30),'parent','Traianos Dellas'),(pg_temp.f360id(31),'parent','Michalis Kapsis'),
 (pg_temp.f360id(35),'parent','Demis Nikolaidis'),(pg_temp.f360id(36),'parent','Zisis Vryzas'),
 (pg_temp.f360id(38),'parent','Pantelis Kafes');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.f360id(100),pg_temp.f360id(1),'Into Matches Academy','F360N1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.f360id(10),pg_temp.f360id(100)),(pg_temp.f360id(11),pg_temp.f360id(100));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.f360id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,22,23,25,26,28]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.f360id(20),pg_temp.f360id(30)),(pg_temp.f360id(21),pg_temp.f360id(31)),(pg_temp.f360id(25),pg_temp.f360id(35)),
 (pg_temp.f360id(26),pg_temp.f360id(36)),(pg_temp.f360id(28),pg_temp.f360id(38));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,age_group) VALUES
 (pg_temp.f360id(40),pg_temp.f360id(10),'Theodoros Zagorakis',pg_temp.f360id(20),'U16'),
 (pg_temp.f360id(41),pg_temp.f360id(10),'Angelos Charisteas',pg_temp.f360id(21),'U16'),
 (pg_temp.f360id(42),pg_temp.f360id(10),'Giorgos Karagounis',pg_temp.f360id(22),'U16'),
 (pg_temp.f360id(43),pg_temp.f360id(10),'Stelios Giannakopoulos',pg_temp.f360id(23),'U16'),
 (pg_temp.f360id(45),pg_temp.f360id(10),'Antonios Nikopolidis',pg_temp.f360id(25),'U16'),
 (pg_temp.f360id(46),pg_temp.f360id(11),'Giourkas Seitaridis',pg_temp.f360id(26),'U16'),
 (pg_temp.f360id(48),pg_temp.f360id(10),'Kostas Katsouranis',pg_temp.f360id(28),'U16');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,squad)
 SELECT pg_temp.f360id(n), pg_temp.f360id(CASE WHEN n = 506 THEN 11 ELSE 10 END), 'vs Team '||n, 'match', 'Team '||n,
  CASE WHEN n = 504 THEN '2020-11-07 15:00+00' ELSE '2054-11-07 15:00+00' END::timestamptz, '19:00', true, 'U16'
 FROM unnest(ARRAY[500,501,502,503,504,505,506,507,508,510,511,512]) n;
-- 511 and 512: matches with no squad stored, as a coach with one squad adds them.
UPDATE public.coach_calendar_events SET squad=NULL WHERE id IN (pg_temp.f360id(511), pg_temp.f360id(512));
INSERT INTO public.academy_features(organization_id,feature) VALUES
 (pg_temp.f360id(100),'games'),(pg_temp.f360id(100),'season_plan');

SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(g), public.record_parental_consent(pg_temp.f360id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.')
 FROM (VALUES (30,20),(31,21),(35,25),(36,26),(38,28)) AS consent(g,c);
RESET ROLE;
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.f360id(43);
UPDATE public.coach_calendar_events SET status='cancelled' WHERE id=pg_temp.f360id(505);
-- Two 11-a-side formations and a 7-a-side one, saved as the app saves them (their rows, written here as the owner):
-- 700 "Balanced" 4-4-2 with the keeper, A, B, Giorgos (consent pending), Stelios (departed) and Kostas; 701 "Press" 4-3-3
-- with the keeper; 702 "Small" 2-3-1 (7 a side) with the keeper and A.
INSERT INTO public.formations(id,coach_user_id,squad,name,format,shape) VALUES
 (pg_temp.f360id(700),pg_temp.f360id(10),'U16','Balanced',11,'4-4-2'),
 (pg_temp.f360id(701),pg_temp.f360id(10),'U16','Press',11,'4-3-3'),
 (pg_temp.f360id(702),pg_temp.f360id(10),'U16','Small',7,'2-3-1');
INSERT INTO public.formation_players(formation_id,slot,squad_player_id) VALUES
 (pg_temp.f360id(700),1,pg_temp.f360id(45)),(pg_temp.f360id(700),2,pg_temp.f360id(40)),(pg_temp.f360id(700),3,pg_temp.f360id(41)),
 (pg_temp.f360id(700),4,pg_temp.f360id(42)),(pg_temp.f360id(700),5,pg_temp.f360id(43)),(pg_temp.f360id(700),6,pg_temp.f360id(48)),
 (pg_temp.f360id(701),1,pg_temp.f360id(45)),
 (pg_temp.f360id(702),1,pg_temp.f360id(45)),(pg_temp.f360id(702),2,pg_temp.f360id(40));
-- Match 502 already has instructions and a saved line-up: B starts in slot 2 with a job, A is on the bench with a job.
INSERT INTO public.game_plans(event_id,strength,scouting,goals) VALUES
 (pg_temp.f360id(502),'stronger','Their 9 is quick.','[{"title":"Win the second ball","looks_like":"First to every loose ball."}]');
INSERT INTO public.game_plan_players(event_id,squad_player_id,role,slot,job,note,context,expectation) VALUES
 (pg_temp.f360id(502),pg_temp.f360id(41),'starter',2,'Old job','','{first_start}','stretch'),
 (pg_temp.f360id(502),pg_temp.f360id(40),'bench',NULL,'Keep this job','Proud of you','{}','usual');
-- B's family said they can't make it to match 501.
INSERT INTO public.event_absences(event_id,squad_player_id,reported_by) VALUES(pg_temp.f360id(501),pg_temp.f360id(41),pg_temp.f360id(31));

-- ── 1. Two matches each get a copy ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT pg_temp.f360check((SELECT jsonb_array_length(public.use_formation_for_matches(pg_temp.f360id(700), ARRAY[pg_temp.f360id(500), pg_temp.f360id(501)])))=2,
  '1 the coach copies a formation into two matches');
SELECT pg_temp.f360check(pg_temp.f360line(500)='40:starter:2 41:starter:3 45:starter:1 48:starter:6',
  '1 match 500 holds the starters in their places; the player with consent pending and the departed one are skipped');
SELECT pg_temp.f360check((SELECT format=11 AND formation='4-4-2' FROM public.game_plans WHERE event_id=pg_temp.f360id(500)),
  '1 and the plan takes its format and shape');
SELECT pg_temp.f360check((SELECT skipped=2 AND not_coming=0 AND NOT by_default FROM public.formation_copies
  WHERE formation_id=pg_temp.f360id(700) AND event_id=pg_temp.f360id(500)),'1 the copy is on record with 2 skipped');
SELECT pg_temp.f360check(pg_temp.f360line(501)='40:starter:2 41:not_attending:- 45:starter:1 48:starter:6',
  '1 a starter whose family said they can''t make it goes to Not attending');
SELECT pg_temp.f360check((SELECT not_coming=1 AND skipped=2 FROM public.formation_copies WHERE formation_id=pg_temp.f360id(700) AND event_id=pg_temp.f360id(501)),
  '1 and the copy says so');
RESET ROLE;
-- The formation is edited afterwards: one starter leaves it and the shape changes.
DELETE FROM public.formation_players WHERE formation_id=pg_temp.f360id(700) AND slot=2;
UPDATE public.formations SET shape='4-3-3' WHERE id=pg_temp.f360id(700);
SELECT pg_temp.f360check(pg_temp.f360line(500)='40:starter:2 41:starter:3 45:starter:1 48:starter:6'
  AND (SELECT formation='4-4-2' FROM public.game_plans WHERE event_id=pg_temp.f360id(500)),
  '1 editing the formation afterwards changes neither match');
INSERT INTO public.formation_players(formation_id,slot,squad_player_id) VALUES(pg_temp.f360id(700),2,pg_temp.f360id(40));
UPDATE public.formations SET shape='4-4-2' WHERE id=pg_temp.f360id(700);

-- ── 2. The rest of the match stays ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT pg_temp.f360check((SELECT jsonb_array_length(public.use_formation_for_matches(pg_temp.f360id(700), ARRAY[pg_temp.f360id(502)])))=1,
  '2 a match with a saved line-up takes a copy (the app asks first)');
SELECT pg_temp.f360check(pg_temp.f360line(502)='40:starter:2 41:starter:3 45:starter:1 48:starter:6',
  '2 the old starter moves to his place in the formation, and the bench player starts');
SELECT pg_temp.f360check((SELECT job='Old job' AND context='{first_start}' AND expectation='stretch' FROM public.game_plan_players
  WHERE event_id=pg_temp.f360id(502) AND squad_player_id=pg_temp.f360id(41))
  AND (SELECT job='Keep this job' AND note='Proud of you' FROM public.game_plan_players
  WHERE event_id=pg_temp.f360id(502) AND squad_player_id=pg_temp.f360id(40)),
  '2 each player''s job, note, context and expectation stay');
SELECT pg_temp.f360check((SELECT strength='stronger' AND scouting='Their 9 is quick.' AND jsonb_array_length(goals)=1 AND formation='4-4-2' FROM public.game_plans
  WHERE event_id=pg_temp.f360id(502)),'2 the instructions stay');
SELECT pg_temp.f360check((SELECT opponent='Team 502' FROM public.coach_calendar_events WHERE id=pg_temp.f360id(502)),'2 and the opponent');

-- ── 3. Only the coach, an open match, and the switches ─────────────────────
SELECT pg_temp.f360actor(11);
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,500),'42501'),'3 another coach can''t use Otto''s formation');
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,500),'42501') AND pg_temp.f360refused('SELECT public.set_default_formation('''||pg_temp.f360id(700)||''', true)','42501'),
  '3 or make it his default');
SELECT pg_temp.f360actor(10);
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,506),'42501'),'3 Otto can''t copy into Fernando''s match');
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,505),'42501'),'3 or a cancelled match');
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,504),'P0001'),'3 or one that has kicked off');
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,500,504),'P0001') AND pg_temp.f360line(500)='40:starter:2 41:starter:3 45:starter:1 48:starter:6',
  '3 one match refused refuses them all');
SELECT pg_temp.f360check(NOT EXISTS (SELECT 1 FROM public.game_plan_players WHERE event_id=pg_temp.f360id(500) AND squad_player_id IN (pg_temp.f360id(42), pg_temp.f360id(43))),
  '3 nobody with consent pending or departed is written');
SELECT pg_temp.f360actor(20);
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,500),'42501'),'3 a player can''t use a formation');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.f360id(100) AND feature='season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,500),'42501'),'3 with the season plan off, nothing is copied');
RESET ROLE;
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.f360id(100),'season_plan');
DELETE FROM public.academy_features WHERE organization_id=pg_temp.f360id(100) AND feature='games';
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT pg_temp.f360check(pg_temp.f360refused(pg_temp.f360use(700,500),'42501'),'3 nor with Games off');
RESET ROLE;
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.f360id(100),'games');

-- ── 4. One default per format ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT public.set_default_formation(pg_temp.f360id(700), true);
SELECT public.set_default_formation(pg_temp.f360id(702), true);
SELECT pg_temp.f360check((SELECT array_agg(right(id::text,3)::int ORDER BY id) FROM public.formations WHERE is_default)=ARRAY[700,702],
  '4 a default for 11 a side and one for 7 a side');
SELECT public.set_default_formation(pg_temp.f360id(701), true);
SELECT pg_temp.f360check((SELECT array_agg(right(id::text,3)::int ORDER BY id) FROM public.formations WHERE is_default)=ARRAY[701,702],
  '4 a new default for a format takes the old one''s place');
RESET ROLE;
SELECT pg_temp.f360check(pg_temp.f360refused(format('UPDATE public.formations SET is_default=true WHERE id=%L', pg_temp.f360id(700)),'23505'),
  '4 the database allows one default per format');
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT public.set_default_formation(pg_temp.f360id(700), true);
SELECT public.set_default_formation(pg_temp.f360id(702), false);
SELECT pg_temp.f360check((SELECT array_agg(right(id::text,3)::int ORDER BY id) FROM public.formations WHERE is_default)=ARRAY[700],
  '4 the coach makes 700 the default again and removes the 7-a-side one');
SELECT public.set_default_formation(pg_temp.f360id(702), true);
SELECT public.save_formation(pg_temp.f360id(702),'U16','Small',11::smallint,'4-3-3','[]'::jsonb);
SELECT pg_temp.f360check((SELECT NOT is_default FROM public.formations WHERE id=pg_temp.f360id(702)),
  '4 a formation that changes format is no longer the default');
SELECT public.save_formation(pg_temp.f360id(702),'U16','Small',7::smallint,'2-3-1',
  jsonb_build_array(jsonb_build_object('slot',1,'squad_player_id',pg_temp.f360id(45)),jsonb_build_object('slot',2,'squad_player_id',pg_temp.f360id(40))));
SELECT public.set_default_formation(pg_temp.f360id(702), true);

-- ── 5. The default loads once, into a fresh match of its format ────────────
INSERT INTO public.game_plans(event_id,format) VALUES(pg_temp.f360id(507),7),(pg_temp.f360id(508),9);
SELECT pg_temp.f360check((public.load_default_formation(pg_temp.f360id(503)) ->> 'formation')='Balanced'
  AND pg_temp.f360line(503)='40:starter:2 41:starter:3 45:starter:1 48:starter:6','5 a fresh match loads the 11-a-side default as a copy');
SELECT pg_temp.f360check((SELECT by_default FROM public.formation_copies WHERE formation_id=pg_temp.f360id(700) AND event_id=pg_temp.f360id(503)),
  '5 and the copy says it was the default');
SELECT pg_temp.f360check(public.load_default_formation(pg_temp.f360id(503)) IS NULL,'5 it loads once');
SELECT pg_temp.f360check((public.load_default_formation(pg_temp.f360id(511)) ->> 'formation')='Balanced' AND pg_temp.f360line(511)='40:starter:2 41:starter:3 45:starter:1 48:starter:6',
  '5 a match with no squad stored belongs to a coach''s one squad, so it loads that squad''s default');
SELECT pg_temp.f360check((SELECT jsonb_array_length(public.use_formation_for_matches(pg_temp.f360id(701), ARRAY[pg_temp.f360id(512)])))=1 AND pg_temp.f360line(512)='45:starter:1',
  '5 and takes a copy');
SELECT pg_temp.f360check((public.load_default_formation(pg_temp.f360id(507)) ->> 'formation')='Small' AND pg_temp.f360line(507)='40:starter:2 45:starter:1',
  '5 a 7-a-side match gets the 7-a-side default');
SELECT pg_temp.f360check(public.load_default_formation(pg_temp.f360id(508)) IS NULL AND pg_temp.f360line(508)='',
  '5 a match of a format with no default gets nothing');
SELECT pg_temp.f360check(public.load_default_formation(pg_temp.f360id(502)) IS NULL AND public.load_default_formation(pg_temp.f360id(500)) IS NULL,
  '5 and a match that already has a line-up gets nothing');
SELECT pg_temp.f360check(pg_temp.f360refused('SELECT public.load_default_formation('''||pg_temp.f360id(506)||''')','42501'),'5 only for the coach''s own match');
SELECT pg_temp.f360check(public.load_default_formation(pg_temp.f360id(504)) IS NULL,'5 and not after kick-off');

-- ── 6. Deleting a formation changes no match ───────────────────────────────
SELECT public.delete_formation(pg_temp.f360id(700));
SELECT pg_temp.f360check(pg_temp.f360line(500)='40:starter:2 41:starter:3 45:starter:1 48:starter:6'
  AND (SELECT formation='4-4-2' FROM public.game_plans WHERE event_id=pg_temp.f360id(500)),'6 deleting the formation leaves its matches as they were');
SELECT pg_temp.f360check(NOT EXISTS (SELECT 1 FROM public.formation_copies WHERE formation_id=pg_temp.f360id(700)),'6 its copy records go with it');
SELECT pg_temp.f360check(public.load_default_formation(pg_temp.f360id(510)) IS NULL AND pg_temp.f360line(510)='',
  '6 and, with no default left for 11 a side, a fresh match gets nothing');

-- ── 7. Who reads the copy records ──────────────────────────────────────────
SELECT pg_temp.f360check((SELECT count(*) FROM public.formation_copies)>0,'7 the coach reads their copy records');
SELECT pg_temp.f360actor(11);
SELECT pg_temp.f360check(NOT EXISTS (SELECT 1 FROM public.formation_copies),'7 another coach reads none');
SELECT pg_temp.f360actor(30);
SELECT pg_temp.f360check(NOT EXISTS (SELECT 1 FROM public.formation_copies),'7 nor does a guardian');
SELECT pg_temp.f360actor(20);
SELECT pg_temp.f360check(NOT EXISTS (SELECT 1 FROM public.formation_copies),'7 nor a player');
SELECT pg_temp.f360check(pg_temp.f360refused('INSERT INTO public.formation_copies(formation_id,event_id,not_coming,skipped) VALUES('''||pg_temp.f360id(701)||''','''||pg_temp.f360id(500)||''',0,0)','42501'),
  '7 nobody writes a record directly');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.f360check(pg_temp.f360refused('SELECT 1 FROM public.formation_copies','42501'),'7 anon can''t read the table at all');
RESET ROLE;

-- ── 8. TRAK-453: Undo puts a match back ────────────────────────────────────
-- 520 is a fresh match; 521 has a saved line-up with jobs and a note, as 502 did. Both take a copy of 703 (its own
-- 4-4-2: the keeper, A, B and Kostas), then Undo.
INSERT INTO public.formations(id,coach_user_id,squad,name,format,shape) VALUES (pg_temp.f360id(703),pg_temp.f360id(10),'U16','Undo me',11,'4-4-2');
INSERT INTO public.formation_players(formation_id,slot,squad_player_id) VALUES
 (pg_temp.f360id(703),1,pg_temp.f360id(45)),(pg_temp.f360id(703),2,pg_temp.f360id(40)),(pg_temp.f360id(703),3,pg_temp.f360id(41)),(pg_temp.f360id(703),6,pg_temp.f360id(48));
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,squad)
 SELECT pg_temp.f360id(n), pg_temp.f360id(10), 'vs Team '||n, 'match', 'Team '||n, '2054-12-07 15:00+00'::timestamptz, '19:00', true, 'U16'
 FROM unnest(ARRAY[520,521]) n;
INSERT INTO public.game_plans(event_id,format,formation,strength) VALUES (pg_temp.f360id(521),7,'2-3-1','stronger');
INSERT INTO public.game_plan_players(event_id,squad_player_id,role,slot,job,note,context,expectation) VALUES
 (pg_temp.f360id(521),pg_temp.f360id(41),'starter',2,'Old job','','{first_start}','stretch'),
 (pg_temp.f360id(521),pg_temp.f360id(40),'bench',NULL,'Keep this job','Proud of you','{}','usual');
CREATE TEMP TABLE f453_before AS
 SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.squad_player_id) FROM public.game_plan_players p WHERE p.event_id = pg_temp.f360id(521)) AS players,
        (SELECT format::text || '/' || formation FROM public.game_plans WHERE event_id = pg_temp.f360id(521)) AS plan,
        (SELECT count(*) FROM public.formation_players WHERE formation_id = pg_temp.f360id(703)) AS saved_starters,
        (SELECT shape FROM public.formations WHERE id = pg_temp.f360id(703)) AS saved_shape;
GRANT SELECT ON f453_before TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT pg_temp.f360check((SELECT jsonb_array_length(public.use_formation_for_matches(pg_temp.f360id(703), ARRAY[pg_temp.f360id(520), pg_temp.f360id(521)])))=2,
  '8 a formation is copied into a fresh match and into one with a saved line-up');
SELECT pg_temp.f360check(pg_temp.f360line(520) <> '' AND (SELECT formation='4-4-2' FROM public.game_plans WHERE event_id=pg_temp.f360id(521)),
  '8 both matches took it');
SELECT pg_temp.f360check((SELECT (public.undo_formation_copy(pg_temp.f360id(703), ARRAY[pg_temp.f360id(520), pg_temp.f360id(521)])->>'undone')::int)=2,
  '8 Undo reports both matches');
SELECT pg_temp.f360check(pg_temp.f360line(520)='' AND NOT EXISTS (SELECT 1 FROM public.game_plans WHERE event_id=pg_temp.f360id(520)),
  '8 the fresh match is back to no plan and no players');
SELECT pg_temp.f360check((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.squad_player_id) FROM public.game_plan_players p WHERE p.event_id = pg_temp.f360id(521))
  = (SELECT players FROM f453_before),
  '8 the other match has every player row back exactly: roles, slots, jobs, notes and expectations');
SELECT pg_temp.f360check((SELECT format::text || '/' || formation FROM public.game_plans WHERE event_id=pg_temp.f360id(521)) = (SELECT plan FROM f453_before),
  '8 and its format and shape');
SELECT pg_temp.f360check(NOT EXISTS (SELECT 1 FROM public.formation_copies WHERE event_id IN (pg_temp.f360id(520), pg_temp.f360id(521))),
  '8 the copies are no longer on record');
SELECT pg_temp.f360check((SELECT count(*) FROM public.formation_players WHERE formation_id = pg_temp.f360id(703)) = (SELECT saved_starters FROM f453_before)
  AND (SELECT shape FROM public.formations WHERE id = pg_temp.f360id(703)) = (SELECT saved_shape FROM f453_before),
  '8 the saved formation is left as it was');
SELECT pg_temp.f360check(pg_temp.f360refused('SELECT 1 FROM public.formation_copy_snapshots','42501'),
  '8 the snapshots are not readable by the app');
SELECT pg_temp.f360check(pg_temp.f360refused('SELECT public.undo_formation_copy('''||pg_temp.f360id(703)||''', ARRAY['''||pg_temp.f360id(520)||'''::uuid])','P0001'),
  '8 a second Undo has nothing to undo');
SELECT pg_temp.f360check((SELECT jsonb_array_length(public.use_formation_for_matches(pg_temp.f360id(703), ARRAY[pg_temp.f360id(520)])))=1,
  '8 a match can be copied into again after Undo');
SELECT pg_temp.f360actor(11);
SELECT pg_temp.f360check(pg_temp.f360refused('SELECT public.undo_formation_copy('''||pg_temp.f360id(703)||''', ARRAY['''||pg_temp.f360id(520)||'''::uuid])','42501'),
  '8 another coach cannot undo it');
SELECT pg_temp.f360actor(30);
SELECT pg_temp.f360check(pg_temp.f360refused('SELECT public.undo_formation_copy('''||pg_temp.f360id(703)||''', ARRAY['''||pg_temp.f360id(520)||'''::uuid])','42501'),
  '8 nor a guardian');
RESET ROLE;
-- The plan is shared after the copy: families may have read it, so Undo is refused.
INSERT INTO public.game_shares(event_id,changed) VALUES (pg_temp.f360id(520),0);
SET LOCAL ROLE authenticated;
SELECT pg_temp.f360actor(10);
SELECT pg_temp.f360check(pg_temp.f360refused('SELECT public.undo_formation_copy('''||pg_temp.f360id(703)||''', ARRAY['''||pg_temp.f360id(520)||'''::uuid])','P0001')
  AND pg_temp.f360line(520) <> '',
  '8 a match whose plan has been shared cannot be undone, and keeps its copy');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.f360_results;
 IF total <> 60 THEN RAISE EXCEPTION 'Formations into matches: % checks ran; expected 60', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.f360_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Formations into matches checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Formations into matches: % of % passed', total, total;
END $$;
ROLLBACK;

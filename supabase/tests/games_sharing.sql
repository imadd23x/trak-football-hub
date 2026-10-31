-- @trak-suite mode=--games-sharing in-all=true
-- TRAK-286 (Games 4/8, spec TRAK-282): Share. Players and families read the plan from copies Share writes, never
-- the coach's working copy. A player reads the goals and their own job, or, left out, that and the coach's note to them
-- (TRAK-319: a note to a selected player doesn't go out); a guardian reads only whether their child starts, is on the
-- bench or isn't in the squad, never the job or the note (TRAK-319, Imad 30 Oct). Nobody reads expectation,
-- context, strength or scouting. Consent and roster rules apply as for events; cancelling the match or switching
-- Games off hides the plan. Edits after sharing stay unshared until the coach shares them, and only the children
-- whose copy changes read "Updated". Test people are named after footballers. Synthetic fixtures; rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing games-sharing fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.g286id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('92860000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE g286_results(label text, ok boolean);
GRANT SELECT, INSERT ON g286_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.g286actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.g286id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.g286check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.g286_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.g286refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.g286share(event integer, talked boolean) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.share_game_plan(%L,%L)', pg_temp.g286id(event), talked)
$$;
-- The squad rows (as fixture numbers) whose copy would change if the coach shared match `event` now.
CREATE FUNCTION pg_temp.g286changes(event integer) RETURNS integer[] LANGUAGE sql AS $$
 SELECT COALESCE(array_agg(right(c.squad_player_id::text,3)::integer ORDER BY c.squad_player_id), '{}')
 FROM public.game_plan_changes(ARRAY[pg_temp.g286id(event)]) c
$$;
-- Copies as fixture numbers, read as whoever is acting.
CREATE FUNCTION pg_temp.g286family() RETURNS integer[] LANGUAGE sql AS $$
 SELECT COALESCE(array_agg(right(squad_player_id::text,3)::integer ORDER BY squad_player_id), '{}') FROM public.game_for_family
$$;
CREATE FUNCTION pg_temp.g286player() RETURNS integer[] LANGUAGE sql AS $$
 SELECT COALESCE(array_agg(right(squad_player_id::text,3)::integer ORDER BY squad_player_id), '{}') FROM public.game_for_player
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has Games: Otto Rehhagel (10) coaches its U16; Fernando Santos (11) coaches there too. Academy
-- Off (101) hasn't: Ange Postecoglou (12). Otto's roster: Theodoros Zagorakis (40, player A), Angelos Charisteas
-- (41, player B), Antonios Nikopolidis (45, keeper), Takis Fyssas (48) and Ioannis Goumas (49), all consented;
-- Giorgos Karagounis (42), consent pending; Stelios Giannakopoulos (43), departed; Kostas Katsouranis (44), U14.
-- Each consented child has a guardian: Traianos Dellas (30) is player A's, Michalis Kapsis (31) player B's. Ange's
-- roster: Angelos Basinas (47).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.g286id(n),'synthetic-'||n||'@games286.invalid',now()
 FROM unnest(ARRAY[1,2,10,11,12,20,21,22,23,24,25,27,28,29,30,31,33,34,35,38,39]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.g286id(1),'club','Vassilis Tsiartas'),(pg_temp.g286id(2),'club','Nikos Dabizas'),
 (pg_temp.g286id(10),'coach','Otto Rehhagel'),(pg_temp.g286id(11),'coach','Fernando Santos'),(pg_temp.g286id(12),'coach','Ange Postecoglou'),
 (pg_temp.g286id(20),'player','Theodoros Zagorakis'),(pg_temp.g286id(21),'player','Angelos Charisteas'),
 (pg_temp.g286id(22),'player','Giorgos Karagounis'),(pg_temp.g286id(23),'player','Stelios Giannakopoulos'),
 (pg_temp.g286id(24),'player','Kostas Katsouranis'),(pg_temp.g286id(25),'player','Antonios Nikopolidis'),
 (pg_temp.g286id(27),'player','Angelos Basinas'),(pg_temp.g286id(28),'player','Takis Fyssas'),(pg_temp.g286id(29),'player','Ioannis Goumas'),
 (pg_temp.g286id(30),'parent','Traianos Dellas'),(pg_temp.g286id(31),'parent','Michalis Kapsis'),
 (pg_temp.g286id(33),'parent','Vasilios Lakis'),(pg_temp.g286id(34),'parent','Pantelis Kafes'),
 (pg_temp.g286id(35),'parent','Demis Nikolaidis'),(pg_temp.g286id(38),'parent','Stylianos Venetidis'),
 (pg_temp.g286id(39),'parent','Georgios Georgiadis');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.g286id(100),pg_temp.g286id(1),'Sharing On Academy','G286N1'),
 (pg_temp.g286id(101),pg_temp.g286id(2),'Sharing Off Academy','G286F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.g286id(10),pg_temp.g286id(100)),(pg_temp.g286id(11),pg_temp.g286id(100)),(pg_temp.g286id(12),pg_temp.g286id(101));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.g286id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,22,23,24,25,27,28,29]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.g286id(20),pg_temp.g286id(30)),(pg_temp.g286id(21),pg_temp.g286id(31)),(pg_temp.g286id(23),pg_temp.g286id(33)),
 (pg_temp.g286id(24),pg_temp.g286id(34)),(pg_temp.g286id(25),pg_temp.g286id(35)),(pg_temp.g286id(28),pg_temp.g286id(38)),
 (pg_temp.g286id(29),pg_temp.g286id(39));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,age_group) VALUES
 (pg_temp.g286id(40),pg_temp.g286id(10),'Theodoros Zagorakis',pg_temp.g286id(20),'U16'),
 (pg_temp.g286id(41),pg_temp.g286id(10),'Angelos Charisteas',pg_temp.g286id(21),'U16'),
 (pg_temp.g286id(42),pg_temp.g286id(10),'Giorgos Karagounis',pg_temp.g286id(22),'U16'),
 (pg_temp.g286id(43),pg_temp.g286id(10),'Stelios Giannakopoulos',pg_temp.g286id(23),'U16'),
 (pg_temp.g286id(44),pg_temp.g286id(10),'Kostas Katsouranis',pg_temp.g286id(24),'U14'),
 (pg_temp.g286id(45),pg_temp.g286id(10),'Antonios Nikopolidis',pg_temp.g286id(25),'U16'),
 (pg_temp.g286id(48),pg_temp.g286id(10),'Takis Fyssas',pg_temp.g286id(28),'U16'),
 (pg_temp.g286id(49),pg_temp.g286id(10),'Ioannis Goumas',pg_temp.g286id(29),'U16'),
 (pg_temp.g286id(47),pg_temp.g286id(12),'Angelos Basinas',pg_temp.g286id(27),'U16');
-- Otto's U16 matches: 500 is the one he shares; 501 isn't published; 502 kicked off long ago; 505 has no plan.
-- 504 is Ange's.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,squad) VALUES
 (pg_temp.g286id(500),pg_temp.g286id(10),'vs Portugal','match','Portugal','2054-11-07 15:00+00','19:00',true,'U16'),
 (pg_temp.g286id(501),pg_temp.g286id(10),'vs France','match','France','2054-11-14 15:00+00','19:00',false,'U16'),
 (pg_temp.g286id(502),pg_temp.g286id(10),'vs Czechia','match','Czechia','2020-11-07 15:00+00','19:00',true,'U16'),
 (pg_temp.g286id(505),pg_temp.g286id(10),'vs Spain','match','Spain','2054-11-21 15:00+00','19:00',true,'U16'),
 (pg_temp.g286id(504),pg_temp.g286id(12),'vs Russia','match','Russia','2054-11-07 15:00+00','19:00',true,'U16');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g286id(100),'games');
INSERT INTO public.game_plans(event_id) VALUES(pg_temp.g286id(501)),(pg_temp.g286id(502)),(pg_temp.g286id(504));

SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(g), public.record_parental_consent(pg_temp.g286id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.')
 FROM (VALUES (30,20),(31,21),(33,23),(34,24),(35,25),(38,28),(39,29)) AS consent(g,c);
-- Otto's draft for 500: a goal, how strong they are and scouting (coach-only), the keeper and player A on the
-- pitch with jobs, player A with a note, context and a Stretch, player B left out with a note. Takis Fyssas isn't
-- placed, so he's on the bench; Ioannis Goumas isn't placed and can't make it.
SELECT pg_temp.g286actor(10);
INSERT INTO public.game_plans(event_id,strength,scouting,goals,formation) VALUES(pg_temp.g286id(500),'stronger','Their 9 is quick.',
 '[{"title":"Win the second ball","looks_like":"First to every loose ball in midfield."}]','4-4-2');
INSERT INTO public.game_plan_players(event_id,squad_player_id,role,slot,job,note,context,expectation) VALUES
 (pg_temp.g286id(500),pg_temp.g286id(45),'starter',1,'Command the box on crosses.','','{}','usual'),
 (pg_temp.g286id(500),pg_temp.g286id(40),'starter',4,'Stay tight to their winger.','Second game at right-back. Proud of you.','{out_of_position}','stretch');
INSERT INTO public.game_plan_players(event_id,squad_player_id,role,note) VALUES
 (pg_temp.g286id(500),pg_temp.g286id(41),'not_selected','Not this week. Your chance comes on Tuesday.');
RESET ROLE;
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.g286id(43);
INSERT INTO public.event_absences(event_id,squad_player_id,reported_by) VALUES(pg_temp.g286id(500),pg_temp.g286id(49),pg_temp.g286id(39));

-- ── 1. Sharing has conditions ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','1 before sharing, player A reads nothing');
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(500,true),'42501'),'1 a player can''t share');
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(501,true),'P0001'),'1 not before the logistics are shared');
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(500,false),'P0001'),'1 not before the coach has talked selection through');
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(502,true),'P0001'),'1 not after kick-off');
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(505,true),'P0001'),'1 not before there is a plan');
SELECT pg_temp.g286actor(11);
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(500,true),'42501'),'1 another coach can''t share Otto''s plan');
SELECT pg_temp.g286actor(12);
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(504,true),'42501'),'1 not in an academy without Games');

-- ── 2. The first share ─────────────────────────────────────────────────────
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check((SELECT public.share_game_plan(pg_temp.g286id(500),true))=4,'2 the coach shares with 4 children');
SELECT pg_temp.g286check((SELECT count(*)=1 AND min(changed)=4 FROM public.game_shares WHERE event_id=pg_temp.g286id(500)),
  '2 the coach reads the share in the log');
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','2 the coach reads no copies: the plan is his');
RESET ROLE;
SELECT pg_temp.g286check((SELECT array_agg(right(squad_player_id::text,3)::integer ORDER BY squad_player_id) FROM public.game_for_family)=ARRAY[40,41,45,48]
  AND (SELECT array_agg(right(squad_player_id::text,3)::integer ORDER BY squad_player_id) FROM public.game_for_player)=ARRAY[40,41,45,48],
  '2 copies for the consented squad who can come or are placed: none for consent pending, departed, U14 or can''t make it');
SELECT pg_temp.g286check((SELECT role='bench' AND job='' AND NOT has_note FROM public.game_for_family WHERE squad_player_id=pg_temp.g286id(48))
  AND (SELECT role='not_selected' AND job='' AND NOT has_note FROM public.game_for_family WHERE squad_player_id=pg_temp.g286id(41))
  AND (SELECT bool_and(job='' AND NOT has_note) FROM public.game_for_family),
  '2 not placed is bench; a family copy holds the role only, never a job or that there''s a note (TRAK-319)');
SELECT pg_temp.g286check((SELECT bool_and(changed_at IS NULL) FROM public.game_for_family) AND (SELECT bool_and(changed_at IS NULL) FROM public.game_for_player),
  '2 nothing reads as updated after the first share');
SELECT pg_temp.g286check(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name IN ('game_for_family','game_for_player') AND column_name IN ('expectation','context','strength','scouting','their_formation','key_players')),
  '2 no copy holds expectation, context, strength or scouting');
-- TRAK-300: a player can't read their coach's profile, so the name travels with the copy.
SELECT pg_temp.g286check((SELECT bool_and(coach_name='Otto Rehhagel') FROM public.game_for_family),
  '2 every family copy carries the coach''s name');

-- ── 3. Who reads what ──────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check(pg_temp.g286family()=ARRAY[40] AND (SELECT role='starter' FROM public.game_for_family),
  '3 player A reads that they start, and nobody else''s copy');
SELECT pg_temp.g286check(pg_temp.g286player()=ARRAY[40] AND (SELECT job='Stay tight to their winger.' AND note=''
  AND goals='[{"title":"Win the second ball","looks_like":"First to every loose ball in midfield."}]'::jsonb FROM public.game_for_player),
  '3 player A reads the goals and their own job in their own copy; a note to a selected player doesn''t go out (TRAK-319)');
SELECT pg_temp.g286check((SELECT coach_name FROM public.game_for_family)='Otto Rehhagel'
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id=pg_temp.g286id(10)),
  '3 player A reads the coach''s name from the copy, though not the coach''s profile');
SELECT pg_temp.g286actor(21);
SELECT pg_temp.g286check(pg_temp.g286family()=ARRAY[41] AND (SELECT role='not_selected' FROM public.game_for_family)
  AND pg_temp.g286player()=ARRAY[41] AND (SELECT note='Not this week. Your chance comes on Tuesday.' AND jsonb_array_length(goals)=1 FROM public.game_for_player),
  '3 player B, left out, reads that, the goals and their own note');
SELECT pg_temp.g286actor(30);
SELECT pg_temp.g286check(pg_temp.g286family()=ARRAY[40] AND (SELECT role='starter' AND job='' AND NOT has_note FROM public.game_for_family),
  '3 player A''s guardian reads only that their child starts: no job, and not that there''s a note (TRAK-319)');
SELECT pg_temp.g286check(pg_temp.g286player()='{}','3 and never the job, the note or the goals');
SELECT pg_temp.g286check((SELECT coach_name FROM public.game_for_family)='Otto Rehhagel','3 and the coach''s name');
SELECT pg_temp.g286actor(31);
SELECT pg_temp.g286check(pg_temp.g286family()=ARRAY[41] AND pg_temp.g286player()='{}','3 player B''s guardian reads only that B is left out');
SELECT pg_temp.g286actor(11);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}' AND NOT EXISTS (SELECT 1 FROM public.game_shares),
  '3 another coach of the academy reads no copy and no share');
SELECT pg_temp.g286check(pg_temp.g286changes(500)='{}','3 or what changed in Otto''s plan');
SELECT pg_temp.g286actor(12);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','3 a coach of another academy reads none');
SELECT pg_temp.g286actor(1);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','3 the academy''s admin reads none');
SELECT pg_temp.g286actor(22);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','3 a child whose consent is pending reads none');
SELECT pg_temp.g286actor(23);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','3 a departed child reads none');
SELECT pg_temp.g286actor(29);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','3 a child who can''t make it and isn''t placed reads none');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.g286check(pg_temp.g286refused('SELECT 1 FROM public.game_for_family','42501')
  AND pg_temp.g286refused('SELECT 1 FROM public.game_for_player','42501'),'3 anon can''t read the copies at all');
RESET ROLE;

-- ── 4. Nobody writes a copy but Share ──────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check(pg_temp.g286refused(format('INSERT INTO public.game_for_family(event_id,squad_player_id,role) VALUES(%L,%L,%L)',
  pg_temp.g286id(500),pg_temp.g286id(40),'starter'),'42501'),'4 a player can''t write a copy');
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286refused(format('UPDATE public.game_for_player SET note=%L',''),'42501')
  AND pg_temp.g286refused(format('DELETE FROM public.game_for_family WHERE event_id=%L',pg_temp.g286id(500)),'42501'),
  '4 the coach can''t change or delete a copy directly');
SELECT pg_temp.g286check(pg_temp.g286refused(format('INSERT INTO public.game_shares(event_id,changed) VALUES(%L,0)',pg_temp.g286id(505)),'42501'),
  '4 or write the share log');

-- ── 5. Changes wait for "Share the changes", and only the changed read Updated ─
UPDATE public.game_plan_players SET job='Stay tight to their winger. Win your headers.'
 WHERE event_id=pg_temp.g286id(500) AND squad_player_id=pg_temp.g286id(40);
UPDATE public.game_plan_players SET expectation='lead' WHERE event_id=pg_temp.g286id(500) AND squad_player_id=pg_temp.g286id(45);
UPDATE public.game_plans SET scouting='Their 9 is quick. Their 7 drifts inside.' WHERE event_id=pg_temp.g286id(500);
SELECT pg_temp.g286check(pg_temp.g286changes(500)=ARRAY[40],'5 a new job is a change for that player; an expectation or scouting isn''t');
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check((SELECT job FROM public.game_for_player)='Stay tight to their winger.','5 until it''s shared, player A reads the old job');
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check((SELECT public.share_game_plan(pg_temp.g286id(500),false))=1,
  '5 the coach shares the changes with 1, without ticking again');
SELECT pg_temp.g286check(pg_temp.g286changes(500)='{}' AND (SELECT count(*)=2 AND min(changed)=1 FROM public.game_shares),
  '5 nothing is left to share, and the log has both shares');
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check((SELECT job='Stay tight to their winger. Win your headers.' AND changed_at IS NOT NULL FROM public.game_for_player),
  '5 player A reads the new job, updated');
SELECT pg_temp.g286actor(30);
SELECT pg_temp.g286check((SELECT changed_at IS NULL AND job='' FROM public.game_for_family),
  '5 their guardian reads nothing new: the job isn''t theirs to read (TRAK-319)');
SELECT pg_temp.g286actor(25);
SELECT pg_temp.g286check((SELECT changed_at IS NULL FROM public.game_for_family) AND (SELECT changed_at IS NULL FROM public.game_for_player),
  '5 the keeper, whose plan didn''t change, sees nothing new');
SELECT pg_temp.g286actor(10);
UPDATE public.game_plans SET goals='[{"title":"Win the second ball","looks_like":"First to every loose ball in midfield."},{"title":"Defend as a block","looks_like":"Ten behind the ball when they have it."}]'
 WHERE event_id=pg_temp.g286id(500);
SELECT pg_temp.g286check(pg_temp.g286changes(500)=ARRAY[40,41,45,48],'5 new goals are a change for every player');
SELECT pg_temp.g286check((SELECT public.share_game_plan(pg_temp.g286id(500),false))=4,'5 and go to all 4');
SELECT pg_temp.g286actor(25);
SELECT pg_temp.g286check((SELECT jsonb_array_length(goals)=2 AND changed_at IS NOT NULL FROM public.game_for_player)
  AND (SELECT changed_at IS NULL FROM public.game_for_family),'5 the keeper reads the new goals as updated');
SELECT pg_temp.g286actor(35);
SELECT pg_temp.g286check((SELECT changed_at IS NULL FROM public.game_for_family) AND pg_temp.g286player()='{}',
  '5 their guardian, who never reads the goals, sees nothing new');
-- TRAK-300: Otto Rehhagel goes by his nickname now; the next share brings it, and marks nobody Updated.
RESET ROLE;
UPDATE public.profiles SET full_name='Rehhakles' WHERE user_id=pg_temp.g286id(10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286changes(500)='{}' AND (SELECT public.share_game_plan(pg_temp.g286id(500),false))=0,
  '5 a new name isn''t a change to announce');
SELECT pg_temp.g286actor(35);
SELECT pg_temp.g286check((SELECT coach_name='Rehhakles' AND changed_at IS NULL FROM public.game_for_family),
  '5 but the next share brings it, and the keeper''s guardian still sees nothing new');
RESET ROLE;
-- Takis Fyssas, on the bench by default, can't make it after all.
INSERT INTO public.event_absences(event_id,squad_player_id,reported_by) VALUES(pg_temp.g286id(500),pg_temp.g286id(48),pg_temp.g286id(38));
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286changes(500)=ARRAY[48],'5 a "Can''t make it" from someone not placed is a change');
SELECT pg_temp.g286check((SELECT public.share_game_plan(pg_temp.g286id(500),false))=1,'5 and shared, it''s 1');
SELECT pg_temp.g286actor(28);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','5 so he no longer reads a place on the bench');
RESET ROLE;
-- The keeper can't make it either, but he's still on the pitch.
INSERT INTO public.event_absences(event_id,squad_player_id,reported_by) VALUES(pg_temp.g286id(500),pg_temp.g286id(45),pg_temp.g286id(35));
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286changes(500)='{}','5 a starter who can''t make it keeps their copy until the coach moves them');

-- ── 6. Roster, consent, the switch and cancelling ──────────────────────────
RESET ROLE;
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.g286id(45);
-- A copy that somehow exists for a child whose consent is pending.
INSERT INTO public.game_for_family(event_id,squad_player_id,role) VALUES(pg_temp.g286id(500),pg_temp.g286id(42),'bench');
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(25);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','6 a child who left the roster reads none');
SELECT pg_temp.g286actor(35);
SELECT pg_temp.g286check(pg_temp.g286family()='{}','6 nor does their guardian');
SELECT pg_temp.g286actor(22);
SELECT pg_temp.g286check(pg_temp.g286family()='{}','6 a child whose consent is pending can''t read even a copy that exists');
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286changes(500)='{}','6 a child who left isn''t a change to share');
SELECT pg_temp.g286check((SELECT public.share_game_plan(pg_temp.g286id(500),false))=0
  AND (SELECT count(*)=4 FROM public.game_shares),'6 sharing nothing new logs nothing');
RESET ROLE;
SELECT pg_temp.g286check((SELECT array_agg(right(squad_player_id::text,3)::integer ORDER BY squad_player_id) FROM public.game_for_family)=ARRAY[40,41],
  '6 but clears the copies nobody may read');
DELETE FROM public.academy_features WHERE organization_id=pg_temp.g286id(100) AND feature='games';
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','6 switched off, player A reads nothing');
SELECT pg_temp.g286actor(30);
SELECT pg_temp.g286check(pg_temp.g286family()='{}','6 nor does their guardian');
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(500,false),'42501'),'6 and the coach can''t share');
RESET ROLE;
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g286id(100),'games');
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check(pg_temp.g286family()=ARRAY[40],'6 switched back on, it''s there again');
RESET ROLE;
UPDATE public.coach_calendar_events SET status='cancelled' WHERE id=pg_temp.g286id(500);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g286actor(20);
SELECT pg_temp.g286check(pg_temp.g286family()='{}' AND pg_temp.g286player()='{}','6 cancelled, player A reads nothing');
SELECT pg_temp.g286actor(30);
SELECT pg_temp.g286check(pg_temp.g286family()='{}','6 nor does their guardian');
SELECT pg_temp.g286actor(10);
SELECT pg_temp.g286check(pg_temp.g286refused(pg_temp.g286share(500,false),'P0001') AND pg_temp.g286changes(500)='{}',
  '6 a cancelled match isn''t shared and has nothing to share');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.g286_results;
 IF total <> 65 THEN RAISE EXCEPTION 'Game sharing: % checks ran; expected 65', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.g286_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Game sharing checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Game sharing: % of % passed', total, total;
END $$;
ROLLBACK;

-- @trak-suite mode=--games-plan-players in-all=true
-- TRAK-285 (Games 3/8, spec TRAK-282): plan step 2, line-up and jobs. The plan's format and formation, and one row
-- per player: starter (in one slot), bench or not selected, job, note, context and expectation. Only the match's
-- coach reads or writes them: no other coach, admin, player, guardian, child without consent or anon. A row is
-- written only for a consented child on the coach's current roster in the match's squad. Writes need the games
-- switch on and a match that isn't cancelled. A slot holds one player and a player one slot; two starters can swap
-- slots in one save. Nobody deletes a row. Test people are named after footballers. Synthetic fixtures; rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing games-plan-players fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.g285id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('92850000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE g285_results(label text, ok boolean);
GRANT SELECT, INSERT ON g285_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.g285actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.g285id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.g285check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.g285_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.g285refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- How many rows a statement changed (0 when a rule hid them).
CREATE FUNCTION pg_temp.g285changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- A line-up row for squad row `player` in match `event`, with extra columns.
CREATE FUNCTION pg_temp.g285row(event integer, player integer, columns text DEFAULT '', vals text DEFAULT '') RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO public.game_plan_players(event_id,squad_player_id%s) VALUES(%L,%L%s)',
   CASE WHEN columns = '' THEN '' ELSE ','||columns END, pg_temp.g285id(event), pg_temp.g285id(player),
   CASE WHEN vals = '' THEN '' ELSE ','||vals END)
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has Games: Otto Rehhagel (10) coaches its U16; Fernando Santos (11) coaches there too. Academy
-- Off (101): Ange Postecoglou (12). Otto's roster: Theodoros Zagorakis (40, player A), Angelos Charisteas (41,
-- player B), Antonios Nikopolidis (45, keeper), all consented; Giorgos Karagounis (42), consent pending; Stelios
-- Giannakopoulos (43), departed; Kostas Katsouranis (44), U14. Fernando's: Giourkas Seitaridis (46). Ange's: Angelos
-- Basinas (47). Each consented child has a guardian; Traianos Dellas (30) is player A's.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.g285id(n),'synthetic-'||n||'@games285.invalid',now()
 FROM unnest(ARRAY[1,2,10,11,12,20,21,22,23,24,25,26,27,30,31,33,34,35,36,37]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.g285id(1),'club','Vassilis Tsiartas'),(pg_temp.g285id(2),'club','Nikos Dabizas'),
 (pg_temp.g285id(10),'coach','Otto Rehhagel'),(pg_temp.g285id(11),'coach','Fernando Santos'),(pg_temp.g285id(12),'coach','Ange Postecoglou'),
 (pg_temp.g285id(20),'player','Theodoros Zagorakis'),(pg_temp.g285id(21),'player','Angelos Charisteas'),
 (pg_temp.g285id(22),'player','Giorgos Karagounis'),(pg_temp.g285id(23),'player','Stelios Giannakopoulos'),
 (pg_temp.g285id(24),'player','Kostas Katsouranis'),(pg_temp.g285id(25),'player','Antonios Nikopolidis'),
 (pg_temp.g285id(26),'player','Giourkas Seitaridis'),(pg_temp.g285id(27),'player','Angelos Basinas'),
 (pg_temp.g285id(30),'parent','Traianos Dellas'),(pg_temp.g285id(31),'parent','Michalis Kapsis'),
 (pg_temp.g285id(33),'parent','Vasilios Lakis'),(pg_temp.g285id(34),'parent','Pantelis Kafes'),
 (pg_temp.g285id(35),'parent','Demis Nikolaidis'),(pg_temp.g285id(36),'parent','Zisis Vryzas'),
 (pg_temp.g285id(37),'parent','Dimitrios Papadopoulos');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.g285id(100),pg_temp.g285id(1),'Line-up On Academy','G285N1'),
 (pg_temp.g285id(101),pg_temp.g285id(2),'Line-up Off Academy','G285F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.g285id(10),pg_temp.g285id(100)),(pg_temp.g285id(11),pg_temp.g285id(100)),(pg_temp.g285id(12),pg_temp.g285id(101));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.g285id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,22,23,24,25,26,27]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.g285id(20),pg_temp.g285id(30)),(pg_temp.g285id(21),pg_temp.g285id(31)),(pg_temp.g285id(23),pg_temp.g285id(33)),
 (pg_temp.g285id(24),pg_temp.g285id(34)),(pg_temp.g285id(25),pg_temp.g285id(35)),(pg_temp.g285id(26),pg_temp.g285id(36)),
 (pg_temp.g285id(27),pg_temp.g285id(37));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,age_group) VALUES
 (pg_temp.g285id(40),pg_temp.g285id(10),'Theodoros Zagorakis',pg_temp.g285id(20),'U16'),
 (pg_temp.g285id(41),pg_temp.g285id(10),'Angelos Charisteas',pg_temp.g285id(21),'U16'),
 (pg_temp.g285id(42),pg_temp.g285id(10),'Giorgos Karagounis',pg_temp.g285id(22),'U16'),
 (pg_temp.g285id(43),pg_temp.g285id(10),'Stelios Giannakopoulos',pg_temp.g285id(23),'U16'),
 (pg_temp.g285id(44),pg_temp.g285id(10),'Kostas Katsouranis',pg_temp.g285id(24),'U14'),
 (pg_temp.g285id(45),pg_temp.g285id(10),'Antonios Nikopolidis',pg_temp.g285id(25),'U16'),
 (pg_temp.g285id(46),pg_temp.g285id(11),'Giourkas Seitaridis',pg_temp.g285id(26),'U16'),
 (pg_temp.g285id(47),pg_temp.g285id(12),'Angelos Basinas',pg_temp.g285id(27),'U16');
-- Otto: 500 a U16 match, 501 a U16 match that gets cancelled, 502 a U16 training. 503 is Fernando's U16 match, 504
-- Ange's.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,squad) VALUES
 (pg_temp.g285id(500),pg_temp.g285id(10),'vs Portugal','match','Portugal','2054-11-07 15:00+00','19:00',true,'U16'),
 (pg_temp.g285id(501),pg_temp.g285id(10),'vs France','match','France','2054-11-14 15:00+00','19:00',true,'U16'),
 (pg_temp.g285id(502),pg_temp.g285id(10),'Training','training',NULL,'2054-11-05 15:00+00','19:00',true,'U16'),
 (pg_temp.g285id(503),pg_temp.g285id(11),'vs Russia','match','Russia','2054-11-07 15:00+00','19:00',true,'U16'),
 (pg_temp.g285id(504),pg_temp.g285id(12),'vs Spain','match','Spain','2054-11-07 15:00+00','19:00',true,'U16');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g285id(100),'games');

SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(g), public.record_parental_consent(pg_temp.g285id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.')
 FROM (VALUES (30,20),(31,21),(33,23),(34,24),(35,25),(36,26),(37,27)) AS consent(g,c);
RESET ROLE;
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.g285id(43);

-- ── 1. Format and formation ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
INSERT INTO public.game_plans(event_id,formation) VALUES(pg_temp.g285id(500),'4-3-3');
SELECT pg_temp.g285check((SELECT format=11 AND formation='4-3-3' FROM public.game_plans WHERE event_id=pg_temp.g285id(500)),
  '1 a new plan is 11 a side, and takes an 11-a-side shape');
SELECT pg_temp.g285check(pg_temp.g285changed(format('UPDATE public.game_plans SET format=7, formation=%L WHERE event_id=%L','2-3-1',pg_temp.g285id(500)))=1,
  '1 the coach changes it to 7 a side in a 7-a-side shape');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plans SET formation=%L WHERE event_id=%L','4-3-3',pg_temp.g285id(500)),'23514'),
  '1 a shape for another format is refused');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plans SET format=6 WHERE event_id=%L',pg_temp.g285id(500)),'23514'),
  '1 a format that isn''t 11, 9, 7 or 5 is refused');
SELECT pg_temp.g285check(pg_temp.g285changed(format('UPDATE public.game_plans SET format=11, formation=%L WHERE event_id=%L','4-4-2',pg_temp.g285id(500)))=1,
  '1 and back to 11 a side');

-- ── 2. The coach's line-up ─────────────────────────────────────────────────
SELECT pg_temp.g285check(pg_temp.g285changed(pg_temp.g285row(500,45,'role,slot,job','''starter'',1,''Command the box on crosses.'''))=1
  AND pg_temp.g285changed(pg_temp.g285row(500,40,'role,slot,job,note,context,expectation',
    '''starter'',4,''Right-back. Stay tight to their winger.'',''Second game at right-back.'',''{out_of_position}'',''stretch'''))=1
  AND pg_temp.g285changed(pg_temp.g285row(500,41))=1,
  '2 the coach places a keeper and a right-back, and player B is on the bench by default');
SELECT pg_temp.g285check((SELECT role='bench' AND slot IS NULL AND expectation='usual' AND context='{}' AND job='' AND note=''
  FROM public.game_plan_players WHERE event_id=pg_temp.g285id(500) AND squad_player_id=pg_temp.g285id(41)),
  '2 a row with nothing set is bench, usual, with no job, note or context');
SELECT pg_temp.g285check(pg_temp.g285changed(format(
  'INSERT INTO public.game_plan_players(event_id,squad_player_id,role,note) VALUES(%L,%L,%L,%L) ON CONFLICT (event_id,squad_player_id) DO UPDATE SET role=excluded.role, note=excluded.note',
  pg_temp.g285id(500),pg_temp.g285id(41),'not_selected','Not this week. Your chance comes on Tuesday.'))=1,
  '2 saving again goes through the app''s upsert: player B is not selected, with a note');

-- ── 3. One player per slot, one slot per player ────────────────────────────
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET role=%L, slot=1, note=%L WHERE event_id=%L AND squad_player_id=%L',
  'starter','',pg_temp.g285id(500),pg_temp.g285id(41)),'23505'),'3 a slot holds one player');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(500,40),'23505'),'3 a player holds one row, so one slot');
SELECT pg_temp.g285check(pg_temp.g285changed(format(
  'INSERT INTO public.game_plan_players(event_id,squad_player_id,role,slot) VALUES(%L,%L,%L,4),(%L,%L,%L,1) ON CONFLICT (event_id,squad_player_id) DO UPDATE SET role=excluded.role, slot=excluded.slot',
  pg_temp.g285id(500),pg_temp.g285id(45),'starter',pg_temp.g285id(500),pg_temp.g285id(40),'starter'))=2,
  '3 two starters swap slots in one save');
SELECT pg_temp.g285check((SELECT array_agg(slot ORDER BY squad_player_id) FROM public.game_plan_players
  WHERE event_id=pg_temp.g285id(500) AND squad_player_id IN (pg_temp.g285id(40),pg_temp.g285id(45)))=ARRAY[1,4]::smallint[],
  '3 and the swap holds: player A in 1, the keeper in 4');

-- ── 4. Only consented children of this roster and squad ────────────────────
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(500,42),'42501'),'4 a child whose consent is pending is refused');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(500,43),'42501'),'4 a departed child is refused');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(500,44),'42501'),'4 a child of another squad (U14) is refused');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(500,46),'42501'),'4 another coach''s child is refused');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(502,40),'42501'),'4 a training has no line-up');

-- ── 5. Nobody else reads the line-up, the notes or the expectations ────────
SELECT pg_temp.g285actor(11);
SELECT pg_temp.g285check(NOT EXISTS(SELECT 1 FROM public.game_plan_players),'5 another coach of the same academy reads none');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(500,41,'role','''bench'''),'42501'),'5 or writes one for Otto''s match');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(503,40),'42501'),'5 or puts Otto''s player in his own match');
SELECT pg_temp.g285actor(12);
SELECT pg_temp.g285check(NOT EXISTS(SELECT 1 FROM public.game_plan_players),'5 a coach of another academy reads none');
SELECT pg_temp.g285actor(1);
SELECT pg_temp.g285check(NOT EXISTS(SELECT 1 FROM public.game_plan_players),'5 the academy''s admin reads none');
SELECT pg_temp.g285actor(20);
SELECT pg_temp.g285check(NOT EXISTS(SELECT 1 FROM public.game_plan_players),'5 player A reads none, not even their own row');
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(500,40,'role','''bench'''),'42501'),'5 or writes one');
SELECT pg_temp.g285actor(21);
SELECT pg_temp.g285check(NOT EXISTS(SELECT 1 FROM public.game_plan_players),'5 player B reads none, not even their note');
SELECT pg_temp.g285actor(30);
SELECT pg_temp.g285check(NOT EXISTS(SELECT 1 FROM public.game_plan_players),'5 player A''s guardian reads none');
SELECT pg_temp.g285actor(22);
SELECT pg_temp.g285check(NOT EXISTS(SELECT 1 FROM public.game_plan_players),'5 a child whose consent is pending reads none');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.g285check(pg_temp.g285refused('SELECT 1 FROM public.game_plan_players','42501'),'5 anon can''t read the table at all');
RESET ROLE;

-- ── 6. A cancelled match, the switch, and no deletes ───────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
SELECT pg_temp.g285check(pg_temp.g285refused(format('DELETE FROM public.game_plan_players WHERE event_id=%L',pg_temp.g285id(500)),'42501'),
  '6 nobody deletes a row, the coach included');
SELECT pg_temp.g285check(pg_temp.g285changed(pg_temp.g285row(501,40))=1,'6 the coach starts a line-up for the second match');
RESET ROLE;
UPDATE public.coach_calendar_events SET status='cancelled' WHERE id=pg_temp.g285id(501);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(501,41),'42501')
  AND pg_temp.g285changed(format('UPDATE public.game_plan_players SET job=%L WHERE event_id=%L','After',pg_temp.g285id(501)))=0,
  '6 once it''s cancelled, nothing is added or changed');
SELECT pg_temp.g285actor(12);
SELECT pg_temp.g285check(pg_temp.g285refused(pg_temp.g285row(504,47),'42501'),'6 a coach of an academy without Games can''t write a line-up');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.g285id(100) AND feature='games';
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
SELECT pg_temp.g285check((SELECT count(*) FROM public.game_plan_players WHERE event_id=pg_temp.g285id(500))=3
  AND pg_temp.g285changed(format('UPDATE public.game_plan_players SET job=%L WHERE event_id=%L','Off',pg_temp.g285id(500)))=0,
  '6 switched off, the coach still reads the line-up but can''t change it');
RESET ROLE;
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g285id(100),'games');

-- ── 7. Bad values are refused ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET role=%L WHERE event_id=%L AND squad_player_id=%L','captain',pg_temp.g285id(500),pg_temp.g285id(45)),'23514'),
  '7 a role that isn''t starter, bench or not selected');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET slot=NULL WHERE event_id=%L AND squad_player_id=%L',pg_temp.g285id(500),pg_temp.g285id(45)),'23514')
  AND pg_temp.g285refused(format('UPDATE public.game_plan_players SET role=%L WHERE event_id=%L AND squad_player_id=%L','bench',pg_temp.g285id(500),pg_temp.g285id(45)),'23514'),
  '7 a starter without a slot, or a bench player with one');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET slot=12 WHERE event_id=%L AND squad_player_id=%L',pg_temp.g285id(500),pg_temp.g285id(45)),'23514'),
  '7 a slot past 11');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET job=%L WHERE event_id=%L AND squad_player_id=%L',repeat('x',301),pg_temp.g285id(500),pg_temp.g285id(45)),'23514')
  AND pg_temp.g285refused(format('UPDATE public.game_plan_players SET note=%L WHERE event_id=%L AND squad_player_id=%L',repeat('x',501),pg_temp.g285id(500),pg_temp.g285id(45)),'23514'),
  '7 a job over 300 or a note over 500');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET context=%L WHERE event_id=%L AND squad_player_id=%L','{injured}',pg_temp.g285id(500),pg_temp.g285id(45)),'23514'),
  '7 a context that isn''t one of the five (and never a diagnosis)');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET expectation=%L WHERE event_id=%L AND squad_player_id=%L','great',pg_temp.g285id(500),pg_temp.g285id(45)),'23514'),
  '7 an expectation that isn''t stretch, usual or lead');
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET job=%L WHERE event_id=%L AND squad_player_id=%L','Warm up well',pg_temp.g285id(500),pg_temp.g285id(41)),'23514'),
  '7 a player not selected keeps only the note: no job');
RESET ROLE;

-- ── 8. Not attending (TRAK-359) ────────────────────────────────────────────
-- Player B (41) is not selected, with a note.
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET role=%L WHERE event_id=%L AND squad_player_id=%L','not_attending',pg_temp.g285id(500),pg_temp.g285id(41)),'23514'),
  '8 Not attending carries nothing: the note has to go with it');
SELECT pg_temp.g285check(pg_temp.g285changed(format('UPDATE public.game_plan_players SET role=%L, note=%L WHERE event_id=%L AND squad_player_id=%L','not_attending','',pg_temp.g285id(500),pg_temp.g285id(41)))=1,
  '8 the match''s coach marks a player Not attending');
SELECT pg_temp.g285actor(11);
SELECT pg_temp.g285check(pg_temp.g285changed(format('UPDATE public.game_plan_players SET role=%L WHERE event_id=%L AND squad_player_id=%L','bench',pg_temp.g285id(500),pg_temp.g285id(41)))=0,
  '8 another coach, even of the same academy, can''t move them');
RESET ROLE;
-- Player B's guardian (31) reports Can't make it.
INSERT INTO public.event_absences(event_id,squad_player_id,reported_by) VALUES(pg_temp.g285id(500),pg_temp.g285id(41),pg_temp.g285id(31));
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
SELECT pg_temp.g285check(pg_temp.g285refused(format('UPDATE public.game_plan_players SET role=%L WHERE event_id=%L AND squad_player_id=%L','bench',pg_temp.g285id(500),pg_temp.g285id(41)),'42501'),
  '8 the database refuses moving a family-reported child out of Not attending');
RESET ROLE;
DELETE FROM public.event_absences WHERE event_id=pg_temp.g285id(500) AND squad_player_id=pg_temp.g285id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g285actor(10);
SELECT pg_temp.g285check(pg_temp.g285changed(format('UPDATE public.game_plan_players SET role=%L WHERE event_id=%L AND squad_player_id=%L','bench',pg_temp.g285id(500),pg_temp.g285id(41)))=1,
  '8 once the family undoes it, the coach moves them');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.g285_results;
 IF total <> 45 THEN RAISE EXCEPTION 'Game plan players: % checks ran; expected 45', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.g285_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Game plan players checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Game plan players: % of % passed', total, total;
END $$;
ROLLBACK;

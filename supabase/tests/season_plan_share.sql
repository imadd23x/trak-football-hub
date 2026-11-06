-- @trak-suite mode=--season-plan-share in-all=true
-- TRAK-356 (Season plan 8/18, spec TRAK-348): the coach shares the season plan through share_season_plan() only. It
-- needs both season dates; at the first share, with something to tell (an open season objective or player
-- objective), the coach's word that they talked it through face to face. Once shared, a season objective is retired,
-- never deleted, and stays readable with its dates; only open ones hold a place. What changes after a share (the
-- dates, the season objectives, each player's objectives) waits on the plan's list until the coach shares the
-- changes; positions don't. Trak keeps the list and the share times: the coach never writes them, and nobody but the
-- plan's coach shares it. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing season-plan-share fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.ss356id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93560000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE ss356_results(label text, ok boolean);
GRANT SELECT, INSERT ON ss356_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.ss356actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ss356id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.ss356check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.ss356_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.ss356refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- How many rows a statement changed (0 when a rule hid them).
CREATE FUNCTION pg_temp.ss356changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE FUNCTION pg_temp.ss356count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
-- One share, as SQL text, for the refusal checks.
CREATE FUNCTION pg_temp.ss356share(n integer, talked boolean DEFAULT false) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('SELECT public.share_season_plan(%L,%L)', pg_temp.ss356id(n), talked)
$$;
-- What a plan waits to share, as one line: its parts, then its players by fixture number. Read as the owner.
CREATE FUNCTION pg_temp.ss356waiting(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT array_to_string(p.unshared_parts, ',') || '|' || coalesce((SELECT string_agg(right(x::text, 2), ',' ORDER BY o)
   FROM unnest(p.unshared_players) WITH ORDINALITY u(x, o)), '')
 FROM public.season_plans p WHERE p.id = pg_temp.ss356id(n)
$$;
CREATE TEMP TABLE ss356_seen(at timestamptz);
GRANT SELECT, INSERT ON ss356_seen TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Admin On (1) runs both.
-- Coach One (10, On): U16 Pat (40, adult 20, Defender) and Quinn (41, adult 21, Midfielder); U14 Uri (46, adult 25).
-- Coach Two (11, On): U16 Rae (42, adult 23, Attacker) and Tia (47, adult 26). Coach Three (12, Off): U16 Sam (43,
-- adult 22). Coach Four (13, On): U15 Uma (48, adult 27).
-- Plans: Coach One's U16 (50, dated, two season objectives 60 and 61) and U14 (51, no dates); Coach Two's U16 (54,
-- dated, no season objectives); Coach Three's U16 (52, dated); Coach Four's U15 (55, dated, nothing in it). Gina (30)
-- is a guardian.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.ss356id(n),'synthetic-'||n||'@share356.invalid',now() FROM unnest(ARRAY[1,10,11,12,13,20,21,22,23,25,26,27,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.ss356id(1),'club','Synthetic Admin On'),
 (pg_temp.ss356id(10),'coach','Synthetic Coach One'),(pg_temp.ss356id(11),'coach','Synthetic Coach Two'),
 (pg_temp.ss356id(12),'coach','Synthetic Coach Three'),(pg_temp.ss356id(13),'coach','Synthetic Coach Four'),
 (pg_temp.ss356id(20),'player','Synthetic Player Pat'),(pg_temp.ss356id(21),'player','Synthetic Player Quinn'),
 (pg_temp.ss356id(22),'player','Synthetic Player Sam'),(pg_temp.ss356id(23),'player','Synthetic Player Rae'),
 (pg_temp.ss356id(25),'player','Synthetic Player Uri'),(pg_temp.ss356id(26),'player','Synthetic Player Tia'),
 (pg_temp.ss356id(27),'player','Synthetic Player Uma'),(pg_temp.ss356id(30),'parent','Synthetic Guardian Gina');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.ss356id(100),pg_temp.ss356id(1),'Share On Academy','S356N1'),
 (pg_temp.ss356id(101),pg_temp.ss356id(1),'Share Off Academy','S356F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.ss356id(10),pg_temp.ss356id(100)),(pg_temp.ss356id(11),pg_temp.ss356id(100)),(pg_temp.ss356id(12),pg_temp.ss356id(101)),
 (pg_temp.ss356id(13),pg_temp.ss356id(100));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.ss356id(n), current_date - interval '20 years' FROM unnest(ARRAY[20,21,22,23,25,26,27]) n;
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.ss356id(40),pg_temp.ss356id(10),'Synthetic Player Pat','U16',pg_temp.ss356id(20),'Defender'),
 (pg_temp.ss356id(41),pg_temp.ss356id(10),'Synthetic Player Quinn','U16',pg_temp.ss356id(21),'Midfielder'),
 (pg_temp.ss356id(46),pg_temp.ss356id(10),'Synthetic Player Uri','U14',pg_temp.ss356id(25),'Midfielder'),
 (pg_temp.ss356id(42),pg_temp.ss356id(11),'Synthetic Player Rae','U16',pg_temp.ss356id(23),'Attacker'),
 (pg_temp.ss356id(47),pg_temp.ss356id(11),'Synthetic Player Tia','U16',pg_temp.ss356id(26),'Defender'),
 (pg_temp.ss356id(48),pg_temp.ss356id(13),'Synthetic Player Uma','U15',pg_temp.ss356id(27),'Goalkeeper'),
 (pg_temp.ss356id(43),pg_temp.ss356id(12),'Synthetic Player Sam','U16',pg_temp.ss356id(22),'Attacker');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.ss356id(100),'season_plan');
INSERT INTO public.season_plans(id,coach_user_id,squad,starts_on,ends_on) VALUES
 (pg_temp.ss356id(50),pg_temp.ss356id(10),'U16','2026-09-01','2027-06-30'),
 (pg_temp.ss356id(51),pg_temp.ss356id(10),'U14',NULL,NULL),
 (pg_temp.ss356id(54),pg_temp.ss356id(11),'U16','2026-09-01','2027-06-30'),
 (pg_temp.ss356id(52),pg_temp.ss356id(12),'U16','2026-09-01','2027-06-30'),
 (pg_temp.ss356id(55),pg_temp.ss356id(13),'U15','2026-09-01','2027-06-30');
INSERT INTO public.season_objectives(id,plan_id,place,title) VALUES
 (pg_temp.ss356id(60),pg_temp.ss356id(50),1,'Win it back within 5 seconds'),(pg_temp.ss356id(61),pg_temp.ss356id(50),2,'Stay compact');

SET LOCAL ROLE authenticated;

-- 1. While the plan is a draft.
SELECT pg_temp.ss356actor(10);
SELECT pg_temp.ss356check(pg_temp.ss356refused(format(
  'UPDATE public.season_objectives SET status = ''retired'' WHERE id = %L',pg_temp.ss356id(60)),'22023'),
  '1 a draft''s objective is deleted, never retired');
SELECT pg_temp.ss356check(pg_temp.ss356refused(format(
  'INSERT INTO public.season_objectives(plan_id,place,title,status,retired_at) VALUES(%L,3,''Gone already'',''retired'',now())',pg_temp.ss356id(50)),'42501')
  AND pg_temp.ss356refused(format(
  'UPDATE public.season_objectives SET retired_at = now() WHERE id = %L',pg_temp.ss356id(60)),'42501'),
  '1 an objective starts open, and only a removed one has a removal date');
SELECT pg_temp.ss356check(pg_temp.ss356refused(format('UPDATE public.season_plans SET last_shared_at = now() WHERE id = %L',pg_temp.ss356id(50)),'42501')
  AND pg_temp.ss356refused(format('UPDATE public.season_plans SET unshared_parts = ''{dates}'' WHERE id = %L',pg_temp.ss356id(50)),'42501')
  AND pg_temp.ss356refused(format('UPDATE public.season_plans SET unshared_players = ARRAY[%L]::uuid[] WHERE id = %L',pg_temp.ss356id(40),pg_temp.ss356id(50)),'42501')
  AND pg_temp.ss356refused('INSERT INTO public.season_plans(squad,last_shared_at) VALUES(''U14'',now())','42501'),
  '1 the coach never writes when a plan was shared or what waits to be shared');
SELECT pg_temp.ss356check(pg_temp.ss356changed(format('UPDATE public.season_plans SET ends_on = ''2027-05-31'' WHERE id = %L',pg_temp.ss356id(50))) = 1
  AND pg_temp.ss356changed(format('UPDATE public.season_objectives SET looks_like = ''The nearest three press.'' WHERE id = %L',pg_temp.ss356id(60))) = 1,
  '1 the coach changes a draft''s dates and objectives');
RESET ROLE;
SELECT pg_temp.ss356check(pg_temp.ss356waiting(50) = '|', '1 a draft lists nothing to share');
SET LOCAL ROLE authenticated;

-- 2. What holds a share back, and who can't share.
SELECT pg_temp.ss356actor(10);
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(51, true),'P0001'), '2 a plan without its dates isn''t shared');
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(50),'P0001'),
  '2 with season objectives, the first share needs the face-to-face talk');
SELECT pg_temp.ss356actor(11);
SELECT public.save_player_objectives(pg_temp.ss356id(42), '[{"title":"Runs in behind","source":"own"}]'::jsonb);
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(54),'P0001'),
  '2 a player''s objective is something to tell too');
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(50, true),'42501')
  AND pg_temp.ss356refused(format('SELECT public.share_season_plan(%L,true)',pg_temp.ss356id(99)),'42501'),
  '2 another coach can''t share the plan, and a made-up one is refused the same way');
SELECT pg_temp.ss356actor(12);
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(52, true),'42501'), '2 switched off, a coach can''t share');
SELECT pg_temp.ss356actor(1);
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(50, true),'42501'), '2 the academy admin can''t share');
SELECT pg_temp.ss356actor(20);
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(50, true),'42501'), '2 the player can''t share');
SELECT pg_temp.ss356actor(30);
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(50, true),'42501'), '2 the guardian can''t share');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(50, true),'42501'), '2 anon can''t share');
RESET ROLE;
UPDATE public.season_plans SET starts_on = '2026-09-01', ends_on = '2027-06-30' WHERE id = pg_temp.ss356id(51);
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.ss356id(46);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ss356actor(10);
SELECT pg_temp.ss356check(pg_temp.ss356refused(pg_temp.ss356share(51, true),'42501'), '2 a squad the coach has left isn''t shared');

-- 3. Sharing.
INSERT INTO pg_temp.ss356_seen SELECT public.share_season_plan(pg_temp.ss356id(50), true);
SELECT pg_temp.ss356check(pg_temp.ss356count(format(
  'SELECT count(*) FROM public.season_plans WHERE id = %L AND shared_at = (SELECT at FROM pg_temp.ss356_seen) AND last_shared_at = shared_at',
  pg_temp.ss356id(50))) = 1, '3 the first share records when, and says when');
SELECT pg_temp.ss356actor(13);
SELECT pg_temp.ss356check(pg_temp.ss356changed(pg_temp.ss356share(55)) = 1
  AND pg_temp.ss356count(format('SELECT count(*) FROM public.season_plans WHERE id = %L AND shared_at IS NOT NULL',pg_temp.ss356id(55))) = 1,
  '3 with no objectives at all, a plan shares without the face-to-face talk');
RESET ROLE;
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.ss356id(42);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ss356actor(11);
SELECT pg_temp.ss356check(pg_temp.ss356changed(pg_temp.ss356share(54)) = 1,
  '3 a player who has left the squad is nobody to tell');

-- 4. Once shared: retire, never delete; what changes waits on the list.
SELECT pg_temp.ss356actor(10);
SELECT pg_temp.ss356check(pg_temp.ss356changed(format('DELETE FROM public.season_objectives WHERE id = %L',pg_temp.ss356id(61))) = 0
  AND pg_temp.ss356count(format('SELECT count(*) FROM public.season_objectives WHERE id = %L',pg_temp.ss356id(61))) = 1,
  '4 a shared plan''s objective can''t be deleted');
SELECT pg_temp.ss356check(pg_temp.ss356changed(format(
  'UPDATE public.season_objectives SET status = ''retired'', retired_at = ''2001-01-01'' WHERE id = %L',pg_temp.ss356id(61))) = 1,
  '4 removing it retires it');
SELECT pg_temp.ss356check(pg_temp.ss356count(format(
  'SELECT count(*) FROM public.season_objectives WHERE id = %L AND status = ''retired'' AND retired_at = now() AND created_at <= retired_at AND title = ''Stay compact''',
  pg_temp.ss356id(61))) = 1, '4 the coach still reads it, with when it was added and when Trak removed it');
SELECT pg_temp.ss356check(pg_temp.ss356refused(format('UPDATE public.season_objectives SET title = ''Stay compacter'' WHERE id = %L',pg_temp.ss356id(61)),'42501')
  AND pg_temp.ss356refused(format('UPDATE public.season_objectives SET status = ''open'', retired_at = NULL WHERE id = %L',pg_temp.ss356id(61)),'42501'),
  '4 a removed objective stays as it was: no rewording, no coming back');
SELECT pg_temp.ss356check(pg_temp.ss356changed(format(
  'INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,2,''Own the set pieces'')',pg_temp.ss356id(50))) = 1
  AND pg_temp.ss356refused(format('INSERT INTO public.season_objectives(plan_id,place,title) VALUES(%L,1,''Same place'')',pg_temp.ss356id(50)),'23505'),
  '4 only open objectives hold a place: a new one takes the removed one''s');
RESET ROLE;
SELECT pg_temp.ss356check(pg_temp.ss356waiting(50) = 'season_objectives|', '4 the season objectives wait to be shared, listed once');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ss356actor(10);
UPDATE public.season_plans SET ends_on = '2027-06-15' WHERE id = pg_temp.ss356id(50);
SELECT public.save_player_objectives(pg_temp.ss356id(41), '[{"title":"Scans before receiving","source":"own"}]'::jsonb);
SELECT public.save_player_objectives(pg_temp.ss356id(40), '[{"title":"Defends 1v1 on the outside","source":"library"}]'::jsonb);
SELECT public.save_player_objectives(pg_temp.ss356id(41), '[]'::jsonb);
RESET ROLE;
SELECT pg_temp.ss356check(pg_temp.ss356waiting(50) = 'season_objectives,dates|41,40',
  '4 new dates wait, and so does each player whose objectives changed, once each');
SELECT pg_temp.ss356check(pg_temp.ss356count(format(
  'SELECT count(*) FROM public.player_objectives WHERE squad_player_id = %L AND status = ''retired'' AND retired_at IS NOT NULL',pg_temp.ss356id(41))) = 1,
  '4 a removed player objective is retired with its date too');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ss356actor(10);
SELECT public.set_player_position(pg_temp.ss356id(40), 'Midfielder');
UPDATE public.season_plans SET positions_known = 'yes' WHERE id = pg_temp.ss356id(50);
RESET ROLE;
SELECT pg_temp.ss356check(pg_temp.ss356waiting(50) = 'season_objectives,dates|41,40', '4 a position or the coach''s answer doesn''t wait');
SELECT pg_temp.ss356check(pg_temp.ss356waiting(54) = '|', '4 another coach''s plan lists none of it');

-- 5. Sharing the changes clears the list, keeps the first share's time and needs no talk.
UPDATE public.season_plans SET shared_at = now() - interval '3 days', last_shared_at = now() - interval '3 days' WHERE id = pg_temp.ss356id(50);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ss356actor(10);
SELECT pg_temp.ss356check(pg_temp.ss356changed(pg_temp.ss356share(50)) = 1, '5 the changes share without the face-to-face talk');
RESET ROLE;
SELECT pg_temp.ss356check(pg_temp.ss356waiting(50) = '|'
  AND pg_temp.ss356count(format('SELECT count(*) FROM public.season_plans WHERE id = %L AND shared_at = now() - interval ''3 days'' AND last_shared_at = now()',
    pg_temp.ss356id(50))) = 1, '5 sharing the changes empties the list and moves only the last share');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ss356actor(10);
SELECT pg_temp.ss356check(pg_temp.ss356changed(format('DELETE FROM public.season_objectives WHERE plan_id = %L',pg_temp.ss356id(50))) = 0,
  '5 still shared, nothing is deleted');
UPDATE public.season_objectives SET title = title, looks_like = looks_like WHERE plan_id = pg_temp.ss356id(50) AND status = 'open';
RESET ROLE;
SELECT pg_temp.ss356check(pg_temp.ss356waiting(50) = '|', '5 saving an objective unchanged lists nothing');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.ss356_results;
 IF total <> 32 THEN RAISE EXCEPTION 'Season plan share: % checks ran; expected 32', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.ss356_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Season plan share checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Season plan share: % of % passed', total, total;
END $$;
ROLLBACK;

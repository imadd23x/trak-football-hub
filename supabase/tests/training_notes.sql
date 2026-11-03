-- @trak-suite mode=--training-notes in-all=true
-- TRAK-339 (Training redo 1/5, spec TRAK-338): a training's Notes. Only the training's coach reads or writes them: no
-- other coach, player, guardian or anon. Writes need the academy's training switch on and the coach's own training,
-- not cancelled; reads don't, so switching off loses nothing. A skip is a row with no answer. Bad values are refused.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing training-notes fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t339id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93390000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t339_results(label text, ok boolean);
GRANT SELECT, INSERT ON t339_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.t339actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t339id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t339check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t339_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.t339refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- How many rows a statement changed (0 when a rule hid them).
CREATE FUNCTION pg_temp.t339changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- Writes notes for an event; the statement, so t339refused can run it.
CREATE FUNCTION pg_temp.t339note(event integer, again text, note text DEFAULT '') RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO public.training_notes(event_id,again,note) VALUES(%L,%L,%L)', pg_temp.t339id(event), again, note)
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has Training: Jürgen Klopp (10) coaches; Pep Guardiola (11) coaches there too.
-- Academy Off (101) hasn't: Carlo Ancelotti (12). Thierry Henry (20) is a player, Patrick Vieira (30) a guardian.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t339id(n),'synthetic-'||n||'@training339.invalid',now() FROM unnest(ARRAY[1,2,10,11,12,20,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t339id(1),'club','Arsène Wenger'),(pg_temp.t339id(2),'club','Alex Ferguson'),
 (pg_temp.t339id(10),'coach','Jürgen Klopp'),(pg_temp.t339id(11),'coach','Pep Guardiola'),
 (pg_temp.t339id(12),'coach','Carlo Ancelotti'),
 (pg_temp.t339id(20),'player','Thierry Henry'),(pg_temp.t339id(30),'parent','Patrick Vieira');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t339id(100),pg_temp.t339id(1),'Training On Academy','T339N1'),
 (pg_temp.t339id(101),pg_temp.t339id(2),'Training Off Academy','T339F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t339id(10),pg_temp.t339id(100)),(pg_temp.t339id(11),pg_temp.t339id(100)),(pg_temp.t339id(12),pg_temp.t339id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES(pg_temp.t339id(20),'2000-01-01');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.t339id(100),'training');
-- Jürgen: 500 a training, 501 a training cancelled, 502 a match, 503 a training for section 5.
-- 504 is Pep's training, 505 Carlo's.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,status) VALUES
 (pg_temp.t339id(500),pg_temp.t339id(10),'Pressing','training',NULL,'2054-11-05 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t339id(501),pg_temp.t339id(10),'Finishing','training',NULL,'2054-11-06 15:00+00','19:00',true,'cancelled'),
 (pg_temp.t339id(502),pg_temp.t339id(10),'vs Everton','match','Everton','2054-11-07 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t339id(503),pg_temp.t339id(10),'Rondos','training',NULL,'2054-11-08 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t339id(504),pg_temp.t339id(11),'Positional play','training',NULL,'2054-11-05 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t339id(505),pg_temp.t339id(12),'Shape','training',NULL,'2054-11-05 15:00+00','19:00',true,'scheduled');

SET LOCAL ROLE authenticated;

-- ── 1. The coach writes notes, then changes them ───────────────────────────
SELECT pg_temp.t339actor(10);
SELECT pg_temp.t339check(pg_temp.t339changed(pg_temp.t339note(500,'changes','Rondo grids too small.'))=1,
  '1 the coach writes notes for their training');
SELECT pg_temp.t339check((SELECT coach_user_id FROM public.training_notes WHERE event_id=pg_temp.t339id(500))=pg_temp.t339id(10),
  '1 stamped as theirs');
SELECT pg_temp.t339check(pg_temp.t339changed(format('UPDATE public.training_notes SET again=%L, note=%L WHERE event_id=%L',
  'yes','Keep it.',pg_temp.t339id(500)))=1,'1 and changes them');
SELECT pg_temp.t339check((SELECT again='yes' AND note='Keep it.' FROM public.training_notes WHERE event_id=pg_temp.t339id(500)),
  '1 the change is kept');
-- A skip: no answer, no note.
SELECT pg_temp.t339check(pg_temp.t339changed(format('INSERT INTO public.training_notes(event_id) VALUES(%L)',pg_temp.t339id(503)))=1,
  '1 a skip is a row with no answer');
SELECT pg_temp.t339check((SELECT again IS NULL AND note='' FROM public.training_notes WHERE event_id=pg_temp.t339id(503)),
  '1 and an empty note');

-- ── 2. Bad values are refused ──────────────────────────────────────────────
SELECT pg_temp.t339check(pg_temp.t339refused(format('UPDATE public.training_notes SET again=%L WHERE event_id=%L','maybe',pg_temp.t339id(500)),'23514'),
  '2 an answer that isn''t yes, changes or no');
SELECT pg_temp.t339check(pg_temp.t339refused(format('UPDATE public.training_notes SET note=%L WHERE event_id=%L',repeat('x',501),pg_temp.t339id(500)),'23514'),
  '2 a note over 500 characters');
SELECT pg_temp.t339check(pg_temp.t339refused(pg_temp.t339note(500,'no'),'23505'),
  '2 a second row for the same training');

-- ── 3. Only their own trainings, and only open trainings ───────────────────
SELECT pg_temp.t339check(pg_temp.t339refused(pg_temp.t339note(504,'yes'),'42501'),
  '3 not another coach''s training');
SELECT pg_temp.t339check(pg_temp.t339refused(pg_temp.t339note(502,'yes'),'42501'),
  '3 not a match');
SELECT pg_temp.t339check(pg_temp.t339refused(pg_temp.t339note(501,'yes'),'42501'),
  '3 not a cancelled training');
SELECT pg_temp.t339check(pg_temp.t339refused(format('INSERT INTO public.training_notes(event_id,coach_user_id,again) VALUES(%L,%L,%L)',
  pg_temp.t339id(504),pg_temp.t339id(11),'yes'),'42501'),'3 not in another coach''s name');

-- ── 4. Nobody else reads or changes them ───────────────────────────────────
SELECT pg_temp.t339actor(11);
SELECT pg_temp.t339check(NOT EXISTS(SELECT 1 FROM public.training_notes),'4 another coach of the academy reads none');
SELECT pg_temp.t339check(pg_temp.t339changed(format('UPDATE public.training_notes SET note=%L WHERE event_id=%L','Mine',pg_temp.t339id(500)))=0,
  '4 nor changes them');
SELECT pg_temp.t339actor(20);
SELECT pg_temp.t339check(NOT EXISTS(SELECT 1 FROM public.training_notes),'4 a player reads none');
SELECT pg_temp.t339check(pg_temp.t339refused(pg_temp.t339note(505,'yes'),'42501'),'4 nor writes any');
SELECT pg_temp.t339actor(30);
SELECT pg_temp.t339check(NOT EXISTS(SELECT 1 FROM public.training_notes),'4 a guardian reads none');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.t339check(pg_temp.t339refused('SELECT 1 FROM public.training_notes','42501'),'4 anon can''t read the table');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.t339actor(10);
SELECT pg_temp.t339check(pg_temp.t339refused(format('DELETE FROM public.training_notes WHERE event_id=%L',pg_temp.t339id(500)),'42501'),
  '4 notes are never deleted, not even by their coach');

-- ── 5. Switched off: writes stop, reads stay ───────────────────────────────
SELECT pg_temp.t339actor(12);
SELECT pg_temp.t339check(pg_temp.t339refused(pg_temp.t339note(505,'yes'),'42501'),
  '5 a coach of an academy without Training can''t write notes');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.t339id(100) AND feature='training';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t339actor(10);
SELECT pg_temp.t339check((SELECT count(*) FROM public.training_notes)=2,'5 switched off, the coach still reads their notes');
SELECT pg_temp.t339check(pg_temp.t339changed(format('UPDATE public.training_notes SET note=%L WHERE event_id=%L','After',pg_temp.t339id(500)))=0,
  '5 but can''t change them');
RESET ROLE;

-- ── 6. Notes go with their training ────────────────────────────────────────
DELETE FROM public.coach_calendar_events WHERE id=pg_temp.t339id(503);
SELECT pg_temp.t339check(NOT EXISTS(SELECT 1 FROM public.training_notes WHERE event_id=pg_temp.t339id(503)),
  '6 deleting a training deletes its notes');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.t339_results;
 IF total <> 24 THEN RAISE EXCEPTION 'Training notes: % checks ran; expected 24', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.t339_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Training notes checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Training notes: % of % passed', total, total;
END $$;
ROLLBACK;

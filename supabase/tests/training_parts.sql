-- @trak-suite mode=--training-parts in-all=true
-- TRAK-340 (Training redo 2/5, spec TRAK-338): a plan of parts. Each practice keeps its part, part type, Trak drill
-- and players; a plan keeps the coach's note; saving throws the draft away. Drafts: only the training's coach reads or
-- writes one; writes need the switch on and the coach's own open training; the coach can always delete one.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing training-parts fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t340id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93400000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t340_results(label text, ok boolean);
GRANT SELECT, INSERT ON t340_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.t340actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t340id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t340check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t340_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.t340refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- How many rows a statement changed (0 when a rule hid them).
CREATE FUNCTION pg_temp.t340changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- A draft for an event; the statement, so t340refused can run it.
CREATE FUNCTION pg_temp.t340draft(event integer, step integer DEFAULT 1) RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO public.training_plan_drafts(event_id,step,body) VALUES(%L,%s,%L::jsonb)', pg_temp.t340id(event), step,
   '{"rows":[{"name":"Rondo","mins":15}],"note":""}')
$$;
-- One part, as the planner sends it.
CREATE FUNCTION pg_temp.t340p(part text, name text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('part',part,'name',name,'minutes',15,'source','own') || extra
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has Training: Jürgen Klopp (10) coaches; Pep Guardiola (11) coaches there too.
-- Academy Off (101) hasn't: Carlo Ancelotti (12). Thierry Henry (20) is a player, Patrick Vieira (30) a guardian.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t340id(n),'synthetic-'||n||'@training340.invalid',now() FROM unnest(ARRAY[1,2,10,11,12,20,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t340id(1),'club','Arsène Wenger'),(pg_temp.t340id(2),'club','Alex Ferguson'),
 (pg_temp.t340id(10),'coach','Jürgen Klopp'),(pg_temp.t340id(11),'coach','Pep Guardiola'),
 (pg_temp.t340id(12),'coach','Carlo Ancelotti'),
 (pg_temp.t340id(20),'player','Thierry Henry'),(pg_temp.t340id(30),'parent','Patrick Vieira');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t340id(100),pg_temp.t340id(1),'Training On Academy','T340N1'),
 (pg_temp.t340id(101),pg_temp.t340id(2),'Training Off Academy','T340F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t340id(10),pg_temp.t340id(100)),(pg_temp.t340id(11),pg_temp.t340id(100)),(pg_temp.t340id(12),pg_temp.t340id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES(pg_temp.t340id(20),'2000-01-01');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.t340id(100),'training');
-- Jürgen: 500 a training, 501 a training cancelled, 502 a match, 503 a training for section 5.
-- 504 is Pep's training, 505 Carlo's.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,status) VALUES
 (pg_temp.t340id(500),pg_temp.t340id(10),'Pressing','training',NULL,'2054-11-05 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t340id(501),pg_temp.t340id(10),'Finishing','training',NULL,'2054-11-06 15:00+00','19:00',true,'cancelled'),
 (pg_temp.t340id(502),pg_temp.t340id(10),'vs Everton','match','Everton','2054-11-07 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t340id(503),pg_temp.t340id(10),'Rondos','training',NULL,'2054-11-08 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t340id(504),pg_temp.t340id(11),'Positional play','training',NULL,'2054-11-05 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t340id(505),pg_temp.t340id(12),'Shape','training',NULL,'2054-11-05 15:00+00','19:00',true,'scheduled');

SET LOCAL ROLE authenticated;

-- ── 1. A plan of parts: each practice keeps its part, Trak drill and players; the plan its note ──
SELECT pg_temp.t340actor(10);
SELECT public.save_training_plan(pg_temp.t340id(500), jsonb_build_array(
  pg_temp.t340p('Dry warm-up','Dynamic warm-up','{"part_type":"warmup","source":"trak","trak_drill":"w1","players_kind":"any"}'),
  pg_temp.t340p('Rondo','Rondo 4 v 2','{"part_type":"rondo","source":"trak","trak_drill":"r1","players_kind":"groups","group_size":6}'),
  pg_temp.t340p('Pressing game','Our press','{"part_type":"own","players_kind":"teams","save_to_drills":true}')),
  '  Remind the back four to talk.  ');
SELECT pg_temp.t340check((SELECT string_agg(part||'/'||part_type||'/'||COALESCE(trak_drill,'-')||'/'||source, ',' ORDER BY position)
  FROM public.training_plan_practices WHERE event_id=pg_temp.t340id(500))='Dry warm-up/warmup/w1/trak,Rondo/rondo/r1/trak,Pressing game/own/-/drill',
  '1 each practice keeps its part, part type and Trak drill');
SELECT pg_temp.t340check((SELECT players_kind='groups' AND group_size=6 FROM public.training_plan_practices
  WHERE event_id=pg_temp.t340id(500) AND position=2),'1 and how many players it takes');
SELECT pg_temp.t340check((SELECT note FROM public.training_plans WHERE event_id=pg_temp.t340id(500))='Remind the back four to talk.',
  '1 the plan keeps the coach''s note, trimmed');
SELECT pg_temp.t340check((SELECT part_type='own' AND players_kind='teams' FROM public.coach_drills WHERE name='Our press'),
  '1 a part saved to My drills keeps its part and players');
-- The old way still works: two arguments, no parts.
SELECT public.save_training_plan(pg_temp.t340id(503), jsonb_build_array(jsonb_build_object('name','Finishing 3v2','minutes',20)));
SELECT pg_temp.t340check((SELECT part='' AND part_type IS NULL AND note='' FROM public.training_plan_practices p
  JOIN public.training_plans t USING (event_id) WHERE p.event_id=pg_temp.t340id(503)),'1 a plan saved without parts still saves');

-- ── 2. Bad values are refused, and the plan is as it was ───────────────────
SELECT pg_temp.t340check(pg_temp.t340refused(format('SELECT public.save_training_plan(%L,%L::jsonb)',pg_temp.t340id(500),
  jsonb_build_array(pg_temp.t340p('Rondo','Rondo','{"source":"trak"}'))),'23514'),'2 a Trak drill must say which');
SELECT pg_temp.t340check(pg_temp.t340refused(format('SELECT public.save_training_plan(%L,%L::jsonb)',pg_temp.t340id(500),
  jsonb_build_array(pg_temp.t340p('Rondo','Rondo','{"trak_drill":"r1"}'))),'23514'),'2 only a Trak drill names one');
SELECT pg_temp.t340check(pg_temp.t340refused(format('SELECT public.save_training_plan(%L,%L::jsonb)',pg_temp.t340id(500),
  jsonb_build_array(pg_temp.t340p('Rondo','Rondo','{"part_type":"yoga"}'))),'23514'),'2 an unknown part type');
SELECT pg_temp.t340check(pg_temp.t340refused(format('SELECT public.save_training_plan(%L,%L::jsonb)',pg_temp.t340id(500),
  jsonb_build_array(pg_temp.t340p(repeat('x',41),'Rondo'))),'23514'),'2 a part name over 40 characters');
SELECT pg_temp.t340check(pg_temp.t340refused(format('SELECT public.save_training_plan(%L,%L::jsonb)',pg_temp.t340id(500),
  jsonb_build_array(pg_temp.t340p('Rondo','Rondo','{"players_kind":"groups","group_size":1}'))),'23514'),'2 a group of one');
SELECT pg_temp.t340check(pg_temp.t340refused(format('SELECT public.save_training_plan(%L,%L::jsonb,%L)',pg_temp.t340id(500),
  jsonb_build_array(pg_temp.t340p('Rondo','Rondo')),repeat('x',501)),'23514'),'2 a note over 500 characters');
SELECT pg_temp.t340check((SELECT count(*) FROM public.training_plan_practices WHERE event_id=pg_temp.t340id(500))=3,
  '2 and the plan is as it was');

-- ── 3. Drafts: the coach's own, kept apart from the plan, thrown away on save ──
SELECT pg_temp.t340check(pg_temp.t340changed(pg_temp.t340draft(500, 2))=1,'3 the coach saves a draft');
SELECT pg_temp.t340check(pg_temp.t340changed(format('UPDATE public.training_plan_drafts SET step=3 WHERE event_id=%L',pg_temp.t340id(500)))=1,
  '3 and changes it');
SELECT pg_temp.t340check((SELECT coach_user_id FROM public.training_plan_drafts WHERE event_id=pg_temp.t340id(500))=pg_temp.t340id(10),
  '3 stamped as theirs');
SELECT pg_temp.t340check(pg_temp.t340refused(pg_temp.t340draft(500),'23505'),'3 one draft per training');
SELECT pg_temp.t340check(pg_temp.t340refused(format('UPDATE public.training_plan_drafts SET step=13 WHERE event_id=%L',pg_temp.t340id(500)),'23514'),
  '3 a step past the last part');
SELECT pg_temp.t340check(pg_temp.t340refused(format('UPDATE public.training_plan_drafts SET body=%L::jsonb WHERE event_id=%L','[1]',pg_temp.t340id(500)),'23514'),
  '3 a body that isn''t the planner''s');
SELECT public.save_training_plan(pg_temp.t340id(500), jsonb_build_array(pg_temp.t340p('Rondo','Rondo 4 v 2')));
SELECT pg_temp.t340check(NOT EXISTS(SELECT 1 FROM public.training_plan_drafts WHERE event_id=pg_temp.t340id(500)),
  '3 saving the plan throws its draft away');
SELECT pg_temp.t340check(pg_temp.t340refused(pg_temp.t340draft(504),'42501'),'3 not for another coach''s training');
SELECT pg_temp.t340check(pg_temp.t340refused(pg_temp.t340draft(502),'42501'),'3 not for a match');
SELECT pg_temp.t340check(pg_temp.t340refused(pg_temp.t340draft(501),'42501'),'3 not for a cancelled training');
SELECT pg_temp.t340check(pg_temp.t340changed(pg_temp.t340draft(503))=1,'3 a second training''s draft');

-- ── 4. Nobody else reads or changes a draft ────────────────────────────────
SELECT pg_temp.t340actor(11);
SELECT pg_temp.t340check(NOT EXISTS(SELECT 1 FROM public.training_plan_drafts),'4 another coach of the academy reads none');
SELECT pg_temp.t340check(pg_temp.t340changed(format('DELETE FROM public.training_plan_drafts WHERE event_id=%L',pg_temp.t340id(503)))=0,
  '4 nor deletes one');
SELECT pg_temp.t340actor(20);
SELECT pg_temp.t340check(NOT EXISTS(SELECT 1 FROM public.training_plan_drafts),'4 a player reads none');
SELECT pg_temp.t340actor(30);
SELECT pg_temp.t340check(NOT EXISTS(SELECT 1 FROM public.training_plan_drafts),'4 a guardian reads none');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.t340check(pg_temp.t340refused('SELECT 1 FROM public.training_plan_drafts','42501'),'4 anon can''t read the table');
RESET ROLE;
SET LOCAL ROLE authenticated;

-- ── 5. Switched off: no new draft, but the coach can still throw one away ──
SELECT pg_temp.t340actor(12);
SELECT pg_temp.t340check(pg_temp.t340refused(pg_temp.t340draft(505),'42501'),'5 a coach of an academy without Training can''t save a draft');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.t340id(100) AND feature='training';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t340actor(10);
SELECT pg_temp.t340check(pg_temp.t340changed(format('UPDATE public.training_plan_drafts SET step=2 WHERE event_id=%L',pg_temp.t340id(503)))=0,
  '5 switched off, a draft can''t change');
SELECT pg_temp.t340check(pg_temp.t340changed(format('DELETE FROM public.training_plan_drafts WHERE event_id=%L',pg_temp.t340id(503)))=1,
  '5 but its coach can delete it');
RESET ROLE;

-- ── 6. A draft goes with its training ──────────────────────────────────────
INSERT INTO public.training_plan_drafts(event_id,coach_user_id,body) VALUES(pg_temp.t340id(500),pg_temp.t340id(10),'{"rows":[]}');
DELETE FROM public.coach_calendar_events WHERE id=pg_temp.t340id(500);
SELECT pg_temp.t340check(NOT EXISTS(SELECT 1 FROM public.training_plan_drafts WHERE event_id=pg_temp.t340id(500)),
  '6 deleting a training deletes its draft');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.t340_results;
 IF total <> 32 THEN RAISE EXCEPTION 'Training parts: % checks ran; expected 32', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.t340_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Training parts checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Training parts: % of % passed', total, total;
END $$;
ROLLBACK;

-- @trak-suite mode=--plan-drill-level in-all=true
-- TRAK-391 (Drill Library 6/11): Add to training. A saved plan keeps each Library drill's level (0 to 7), as the coach
-- set it on the drill page. Only a Trak drill has one; a level out of range, or on any other practice, is refused and
-- the plan stays as it was. A plan saved the old way, and every plan from before, has none. Only the training's coach
-- reads it, as the rest of the plan. Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing plan-drill-level fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t391id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93910000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t391_results(label text, ok boolean);
GRANT SELECT, INSERT ON t391_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.t391actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t391id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t391check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t391_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.t391refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- One part, as the planner sends it.
CREATE FUNCTION pg_temp.t391p(part text, name text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('part',part,'name',name,'minutes',15,'source','own') || extra
$$;
-- A save of one part to Jürgen's training, as a statement, so t391refused can run it.
CREATE FUNCTION pg_temp.t391save(extra jsonb) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.save_training_plan(%L,%L::jsonb)', pg_temp.t391id(500), jsonb_build_array(pg_temp.t391p('Rondo','Rondo',extra)))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has Training: Jürgen Klopp (10) and Pep Guardiola (11) coach there. Jürgen has two trainings.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t391id(n),'synthetic-'||n||'@level391.invalid',now() FROM unnest(ARRAY[1,10,11]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t391id(1),'club','Arsène Wenger'),(pg_temp.t391id(10),'coach','Jürgen Klopp'),(pg_temp.t391id(11),'coach','Pep Guardiola');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t391id(100),pg_temp.t391id(1),'Level On Academy','T391N1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t391id(10),pg_temp.t391id(100)),(pg_temp.t391id(11),pg_temp.t391id(100));
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.t391id(100),'training');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,status) VALUES
 (pg_temp.t391id(500),pg_temp.t391id(10),'Pressing','training',NULL,'2054-11-05 15:00+00','19:00',true,'scheduled'),
 (pg_temp.t391id(501),pg_temp.t391id(10),'Rondos','training',NULL,'2054-11-06 15:00+00','19:00',true,'scheduled');

SET LOCAL ROLE authenticated;

-- ── 1. A Library drill keeps its level; the rest have none ─────────────────
SELECT pg_temp.t391actor(10);
SELECT public.save_training_plan(pg_temp.t391id(500), jsonb_build_array(
  pg_temp.t391p('Passing & movement','Four corners','{"part_type":"passing","source":"trak","trak_drill":"lib-four-corners"}'),
  pg_temp.t391p('Rondo','Keep the ball','{"part_type":"rondo","source":"trak","trak_drill":"lib-keep-the-ball","trak_level":5}'),
  pg_temp.t391p('Pressing game','Our press','{"part_type":"own"}')));
SELECT pg_temp.t391check((SELECT string_agg(COALESCE(trak_level::text,'-'), ',' ORDER BY position)
  FROM public.training_plan_practices WHERE event_id=pg_temp.t391id(500))='-,5,-',
  '1 a Library drill keeps the level the coach set; the others have none');
SELECT public.save_training_plan(pg_temp.t391id(501), jsonb_build_array(pg_temp.t391p('Rondo','Keep the ball',
  '{"source":"trak","trak_drill":"lib-keep-the-ball","trak_level":0}'),pg_temp.t391p('Game','Game','{"source":"trak","trak_drill":"lib-game","trak_level":7}')));
SELECT pg_temp.t391check((SELECT array_agg(trak_level ORDER BY position) FROM public.training_plan_practices
  WHERE event_id=pg_temp.t391id(501))=ARRAY[0,7]::smallint[],'1 the easiest and the hardest are kept');

-- ── 2. Bad levels are refused, and the plan is as it was ───────────────────
SELECT pg_temp.t391check(pg_temp.t391refused(pg_temp.t391save('{"source":"trak","trak_drill":"lib-x","trak_level":8}'),'23514'),
  '2 a level over 7');
SELECT pg_temp.t391check(pg_temp.t391refused(pg_temp.t391save('{"source":"trak","trak_drill":"lib-x","trak_level":-1}'),'23514'),
  '2 a level under 0');
SELECT pg_temp.t391check(pg_temp.t391refused(pg_temp.t391save('{"trak_level":3}'),'23514'),
  '2 a level on a practice that isn''t a Trak drill');
SELECT pg_temp.t391check(pg_temp.t391refused(pg_temp.t391save('{"source":"trak","trak_drill":"lib-x","trak_level":"hard"}'),'22P02'),
  '2 a level that isn''t a number');
SELECT pg_temp.t391check((SELECT string_agg(COALESCE(trak_level::text,'-'), ',' ORDER BY position)
  FROM public.training_plan_practices WHERE event_id=pg_temp.t391id(500))='-,5,-','2 and the plan is as it was');

-- ── 3. Nobody else reads it ────────────────────────────────────────────────
SELECT pg_temp.t391actor(11);
SELECT pg_temp.t391check(NOT EXISTS(SELECT 1 FROM public.training_plan_practices WHERE trak_level IS NOT NULL),
  '3 another coach of the same academy reads no levels');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.t391_results;
 IF total <> 8 THEN RAISE EXCEPTION 'Plan drill level: % checks ran; expected 8', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.t391_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Plan drill level checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Plan drill level: % of % passed', total, total;
END $$;
ROLLBACK;

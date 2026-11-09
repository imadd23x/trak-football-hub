-- @trak-suite mode=--drill-bookmarks in-all=true
-- TRAK-390 (Drill Library 5/11): a coach's bookmarks (My drills) are theirs alone: no other coach, player, guardian or
-- anon reads or changes them. Adding and taking out need the academy's training switch on; reading doesn't, so
-- switching off keeps them. A bookmark can't be changed, only added or taken out. Bad values are refused.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing drill-bookmarks fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t390id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93900000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t390_results(label text, ok boolean);
GRANT SELECT, INSERT ON t390_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.t390actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t390id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t390check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t390_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.t390refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- How many rows a statement changed (0 when a rule hid them).
CREATE FUNCTION pg_temp.t390changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Two academies: On (100) has Training, Off (101) doesn't. Jürgen Klopp and Pep Guardiola coach at On, Carlo
-- Ancelotti at Off; Thierry Henry is a player and Patrick Vieira a guardian.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t390id(n),'synthetic-'||n||'@bookmarks390.invalid',now() FROM unnest(ARRAY[1,2,10,11,12,20,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t390id(1),'club','Arsène Wenger'),(pg_temp.t390id(2),'club','Alex Ferguson'),
 (pg_temp.t390id(10),'coach','Jürgen Klopp'),(pg_temp.t390id(11),'coach','Pep Guardiola'),
 (pg_temp.t390id(12),'coach','Carlo Ancelotti'),(pg_temp.t390id(20),'player','Thierry Henry'),
 (pg_temp.t390id(30),'parent','Patrick Vieira');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t390id(100),pg_temp.t390id(1),'Bookmarks On Academy','T390N1'),
 (pg_temp.t390id(101),pg_temp.t390id(2),'Bookmarks Off Academy','T390F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t390id(10),pg_temp.t390id(100)),(pg_temp.t390id(11),pg_temp.t390id(100)),(pg_temp.t390id(12),pg_temp.t390id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES(pg_temp.t390id(20),'2000-01-01');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.t390id(100),'training');

-- ── 1. A coach bookmarks a drill ───────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.t390actor(10);
INSERT INTO public.coach_drill_bookmarks(drill) VALUES('lib-keep-the-ball'),('lib-four-corners');
SELECT pg_temp.t390check((SELECT count(*) FROM public.coach_drill_bookmarks WHERE coach_user_id=pg_temp.t390id(10))=2,
  '1 a coach bookmarks drills, and they are theirs');
SELECT pg_temp.t390check(pg_temp.t390refused('INSERT INTO public.coach_drill_bookmarks(drill) VALUES(''lib-keep-the-ball'')','23505'),
  '1 the same drill twice is refused');
SELECT pg_temp.t390check(pg_temp.t390refused(format('INSERT INTO public.coach_drill_bookmarks(coach_user_id,drill) VALUES(%L,%L)',
  pg_temp.t390id(11),'lib-for-pep'),'42501'),'1 a coach can''t bookmark in another coach''s name');
SELECT pg_temp.t390check(pg_temp.t390refused('UPDATE public.coach_drill_bookmarks SET drill=''lib-other''','42501'),
  '1 a bookmark can''t be changed, only added or taken out');

-- ── 2. Nobody else reads or changes them ───────────────────────────────────
SELECT pg_temp.t390actor(11);
SELECT pg_temp.t390check(NOT EXISTS(SELECT 1 FROM public.coach_drill_bookmarks),'2 another coach of the same academy reads none');
SELECT pg_temp.t390check(pg_temp.t390changed('DELETE FROM public.coach_drill_bookmarks')=0,'2 or takes one out');
SELECT pg_temp.t390actor(20);
SELECT pg_temp.t390check(NOT EXISTS(SELECT 1 FROM public.coach_drill_bookmarks),'2 a player reads none');
SELECT pg_temp.t390check(pg_temp.t390refused('INSERT INTO public.coach_drill_bookmarks(drill) VALUES(''lib-mine'')','42501'),
  '2 or adds one');
SELECT pg_temp.t390actor(30);
SELECT pg_temp.t390check(NOT EXISTS(SELECT 1 FROM public.coach_drill_bookmarks),'2 a guardian reads none');
SELECT pg_temp.t390check(pg_temp.t390refused('INSERT INTO public.coach_drill_bookmarks(drill) VALUES(''lib-mine'')','42501'),
  '2 or adds one');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.t390check(pg_temp.t390refused('SELECT 1 FROM public.coach_drill_bookmarks','42501'),'2 anon can''t read the table at all');
RESET ROLE;

-- ── 3. Bad values are refused ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.t390actor(10);
SELECT pg_temp.t390check(pg_temp.t390refused('INSERT INTO public.coach_drill_bookmarks(drill) VALUES('''')','23514'),'3 an empty drill');
SELECT pg_temp.t390check(pg_temp.t390refused(format('INSERT INTO public.coach_drill_bookmarks(drill) VALUES(%L)',repeat('x',41)),'23514'),
  '3 a drill over 40');

-- ── 4. Switched off: writes stop, reads stay ───────────────────────────────
SELECT pg_temp.t390actor(12);
SELECT pg_temp.t390check(pg_temp.t390refused('INSERT INTO public.coach_drill_bookmarks(drill) VALUES(''lib-off'')','42501'),
  '4 a coach of an academy without Training can''t bookmark');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.t390id(100) AND feature='training';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t390actor(10);
SELECT pg_temp.t390check((SELECT count(*) FROM public.coach_drill_bookmarks)=2,'4 switched off, the coach still reads their bookmarks');
SELECT pg_temp.t390check(pg_temp.t390refused('INSERT INTO public.coach_drill_bookmarks(drill) VALUES(''lib-after'')','42501'),
  '4 but can''t add one');
SELECT pg_temp.t390check(pg_temp.t390changed('DELETE FROM public.coach_drill_bookmarks WHERE drill=''lib-four-corners''')=0,
  '4 or take one out');
RESET ROLE;

-- ── 5. Back on: the coach takes one out ────────────────────────────────────
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.t390id(100),'training');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t390actor(10);
SELECT pg_temp.t390check(pg_temp.t390changed('DELETE FROM public.coach_drill_bookmarks WHERE drill=''lib-four-corners''')=1,
  '5 the coach takes their own bookmark out');
SELECT pg_temp.t390check((SELECT array_agg(drill) FROM public.coach_drill_bookmarks)=ARRAY['lib-keep-the-ball'],'5 and the other stays');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.t390_results;
 IF total <> 19 THEN RAISE EXCEPTION 'Drill bookmarks: % checks ran; expected 19', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.t390_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Drill bookmarks checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Drill bookmarks: % of % passed', total, total;
END $$;
ROLLBACK;

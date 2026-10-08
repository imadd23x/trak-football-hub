-- @trak-suite mode=--events-switch in-all=true
-- TRAK-124 (J8.1): events turn on or off per academy, with no deploy. A coach
-- writes their own events only while their academy's switch is on, and
-- deleting the switch row refuses the next write. App roles can neither read
-- nor change switches. Only 42501 or zero affected rows count as denial;
-- trusted readbacks check what actually persisted.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing events-switch fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.e81id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('98100000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE e81_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON e81_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.e81actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role',current_user,'sub',pg_temp.e81id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.e81check(ok boolean,label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.e81_results VALUES(label,ok IS TRUE,NULL)
$$;
-- The statement must succeed and touch exactly expected_rows rows.
CREATE FUNCTION pg_temp.e81allowed(statement text, label text, expected_rows bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS n = ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.e81_results VALUES(label, st IS NULL AND n = expected_rows, coalesce(st||': '||msg,'affected rows='||n));
END $$;
-- The statement must be refused: 42501, or zero rows touched.
CREATE FUNCTION pg_temp.e81denied(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS n = ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.e81_results VALUES(label, coalesce(st = '42501', st IS NULL AND n = 0), coalesce(st||': '||msg,'affected rows='||n));
END $$;
CREATE FUNCTION pg_temp.e81insert(coach integer, event integer) RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at) VALUES(%L,%L,%L,%L)',
  pg_temp.e81id(event),pg_temp.e81id(coach),'Synthetic training','2026-11-02 16:00+00')
$$;

-- Two academies: On (100) and Off (101). Coach A and colleague A2 are in On,
-- coach B in Off, coach C has no academy. Player P is an adult (no consent).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.e81id(n),'synthetic-'||n||'@events81.invalid',now()
 FROM unnest(ARRAY[1,2,10,11,12,13,20]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.e81id(1),'club','Admin On'),(pg_temp.e81id(2),'club','Admin Off'),
 (pg_temp.e81id(10),'coach','Coach A'),(pg_temp.e81id(11),'coach','Coach A2'),
 (pg_temp.e81id(12),'coach','Coach B'),(pg_temp.e81id(13),'coach','Coach C'),
 (pg_temp.e81id(20),'player','Player P');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.e81id(100),pg_temp.e81id(1),'Switch On Academy','E81ON1'),
 (pg_temp.e81id(101),pg_temp.e81id(2),'Switch Off Academy','E81OF1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.e81id(10),pg_temp.e81id(100)),(pg_temp.e81id(11),pg_temp.e81id(100)),
 (pg_temp.e81id(12),pg_temp.e81id(101)),(pg_temp.e81id(13),NULL);
INSERT INTO public.player_details(user_id,date_of_birth) VALUES(pg_temp.e81id(20),'2000-01-01');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at,published) VALUES
 (pg_temp.e81id(500),pg_temp.e81id(10),'A own event','2026-11-01',true),
 (pg_temp.e81id(501),pg_temp.e81id(11),'A2 event','2026-11-01',true),
 (pg_temp.e81id(510),pg_temp.e81id(12),'B own event','2026-11-01',true);

-- The operator switches the On academy on: one INSERT, no deploy.
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.e81id(100),'events');

-- The switch table is operator-only, and only known features exist.
DO $$ DECLARE r text; op text; BEGIN
 PERFORM pg_temp.e81check((SELECT relrowsecurity FROM pg_class WHERE oid='public.academy_features'::regclass),'Switch table has row-level security on');
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH op IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
   PERFORM pg_temp.e81check(NOT has_table_privilege(r,'public.academy_features',op),r||' has no '||op||' on the switch table');
  END LOOP;
 END LOOP;
 PERFORM pg_temp.e81check(NOT EXISTS(SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
  WHERE c.oid='public.academy_features'::regclass AND a.grantee=0),'PUBLIC has nothing on the switch table');
 PERFORM pg_temp.e81check(NOT has_function_privilege('anon','public.feature_on(text)','EXECUTE'),'anon cannot ask feature_on');
 PERFORM pg_temp.e81check(has_function_privilege('authenticated','public.feature_on(text)','EXECUTE'),'authenticated can ask feature_on');
END $$;
DO $$ DECLARE st text; BEGIN
 BEGIN
  INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.e81id(101),'event');
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE;
 END;
 PERFORM pg_temp.e81check(st = '23514','A misspelt feature name is refused, not silently off');
END $$;

SET LOCAL ROLE authenticated;
-- Coach A, academy switched on: own events can be created, edited and deleted.
SELECT pg_temp.e81actor(10);
SELECT pg_temp.e81check(public.feature_on('events'),'On: feature_on is true for coach A');
SELECT pg_temp.e81check(NOT public.feature_on('awards'),'On: an unknown feature is off');
SELECT pg_temp.e81allowed(pg_temp.e81insert(10,520),'On: coach A creates an event',1);
SELECT pg_temp.e81allowed(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','Edited by A',pg_temp.e81id(500)),'On: coach A edits own event',1);
SELECT pg_temp.e81allowed(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.e81id(520)),'On: coach A deletes own event',1);
-- Still only their own events.
SELECT pg_temp.e81denied(pg_temp.e81insert(11,521),'On: coach A cannot create an event as A2');
SELECT pg_temp.e81denied(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','Hijacked',pg_temp.e81id(501)),'On: coach A cannot edit A2''s event');
SELECT pg_temp.e81denied(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.e81id(501)),'On: coach A cannot delete A2''s event');
SELECT pg_temp.e81denied(format('UPDATE public.coach_calendar_events SET coach_user_id=%L WHERE id=%L',pg_temp.e81id(12),pg_temp.e81id(500)),'On: coach A cannot hand an event to coach B');
-- App roles can't see or change switches.
SELECT pg_temp.e81denied('SELECT count(*) FROM public.academy_features','Coach cannot read switches');
SELECT pg_temp.e81denied(format('INSERT INTO public.academy_features(organization_id,feature) VALUES(%L,%L)',pg_temp.e81id(101),'events'),'Coach cannot switch another academy on');
SELECT pg_temp.e81denied(format('DELETE FROM public.academy_features WHERE organization_id=%L',pg_temp.e81id(100)),'Coach cannot switch own academy off');
SELECT pg_temp.e81denied(format('UPDATE public.academy_features SET organization_id=%L',pg_temp.e81id(101)),'Coach cannot move a switch');

-- Coach B, academy switched off: refused by the database, even for own rows.
SELECT pg_temp.e81actor(12);
SELECT pg_temp.e81check(NOT public.feature_on('events'),'Off: feature_on is false for coach B');
SELECT pg_temp.e81denied(pg_temp.e81insert(12,530),'Off: coach B cannot create an event');
SELECT pg_temp.e81denied(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','Edited by B',pg_temp.e81id(510)),'Off: coach B cannot edit own event');
SELECT pg_temp.e81denied(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.e81id(510)),'Off: coach B cannot delete own event');
SELECT pg_temp.e81check((SELECT count(*) FROM public.coach_calendar_events WHERE id=pg_temp.e81id(510))=1,'Off: coach B still reads own event');

-- No academy, or not a coach: off.
SELECT pg_temp.e81actor(13);
SELECT pg_temp.e81check(NOT public.feature_on('events'),'No academy: feature_on is false');
SELECT pg_temp.e81denied(pg_temp.e81insert(13,540),'No academy: coach C cannot create an event');
SELECT pg_temp.e81actor(20);
SELECT pg_temp.e81check(NOT public.feature_on('events'),'Player: feature_on is false');
SELECT pg_temp.e81denied(pg_temp.e81insert(20,550),'Player cannot create an event');
SELECT pg_temp.e81actor(1);
SELECT pg_temp.e81denied(pg_temp.e81insert(1,560),'Academy admin of an On academy cannot create an event');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_temp.e81denied('SELECT public.feature_on(''events'')','Anonymous cannot ask feature_on');
SELECT pg_temp.e81denied(pg_temp.e81insert(10,570),'Anonymous cannot create an event');
RESET ROLE;

-- Trusted readback: exactly what was allowed persisted.
SELECT pg_temp.e81check((SELECT title='Edited by A' AND coach_user_id=pg_temp.e81id(10) FROM public.coach_calendar_events WHERE id=pg_temp.e81id(500)),'Readback: A''s edit persisted, owner unchanged');
SELECT pg_temp.e81check(NOT EXISTS(SELECT 1 FROM public.coach_calendar_events WHERE id=pg_temp.e81id(520)),'Readback: A''s delete persisted');
SELECT pg_temp.e81check((SELECT title='A2 event' FROM public.coach_calendar_events WHERE id=pg_temp.e81id(501)),'Readback: A2''s event untouched');
SELECT pg_temp.e81check((SELECT title='B own event' FROM public.coach_calendar_events WHERE id=pg_temp.e81id(510)),'Readback: B''s event untouched');
SELECT pg_temp.e81check(NOT EXISTS(SELECT 1 FROM public.coach_calendar_events WHERE id IN
 (pg_temp.e81id(521),pg_temp.e81id(530),pg_temp.e81id(540),pg_temp.e81id(550),pg_temp.e81id(560),pg_temp.e81id(570))),'Readback: no refused event exists');
SELECT pg_temp.e81check((SELECT count(*)=1 FROM public.academy_features)
 AND EXISTS(SELECT 1 FROM public.academy_features WHERE organization_id=pg_temp.e81id(100) AND feature='events'),'Readback: switches unchanged by app roles');

-- The operator switches the On academy off: one DELETE, no deploy. The very
-- next write is refused.
DELETE FROM public.academy_features WHERE organization_id=pg_temp.e81id(100) AND feature='events';
SET LOCAL ROLE authenticated;
SELECT pg_temp.e81actor(10);
SELECT pg_temp.e81check(NOT public.feature_on('events'),'Switched off: feature_on is false for coach A');
SELECT pg_temp.e81denied(pg_temp.e81insert(10,580),'Switched off: coach A cannot create an event');
SELECT pg_temp.e81denied(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','After off',pg_temp.e81id(500)),'Switched off: coach A cannot edit own event');
SELECT pg_temp.e81check((SELECT count(*) FROM public.coach_calendar_events WHERE id=pg_temp.e81id(500))=1,'Switched off: coach A still reads own event');
RESET ROLE;

-- Defense in depth: a stray broad grant or permissive policy must not reopen
-- writes for an academy that is off. Changes roll back with the suite.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.coach_calendar_events TO PUBLIC,anon,authenticated;
CREATE POLICY e81_test_overlapping_allow ON public.coach_calendar_events FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.e81actor(12);
SELECT pg_temp.e81denied(pg_temp.e81insert(12,590),'Overlapping allow: coach B (off) still cannot create');
SELECT pg_temp.e81denied(format('UPDATE public.coach_calendar_events SET title=%L WHERE id=%L','Via overlap',pg_temp.e81id(510)),'Overlapping allow: coach B (off) still cannot edit');
SELECT pg_temp.e81actor(20);
SELECT pg_temp.e81denied(pg_temp.e81insert(20,591),'Overlapping allow: player still cannot create');
RESET ROLE;
SELECT pg_temp.e81check((SELECT title='Edited by A' FROM public.coach_calendar_events WHERE id=pg_temp.e81id(500))
 AND (SELECT title='B own event' FROM public.coach_calendar_events WHERE id=pg_temp.e81id(510))
 AND NOT EXISTS(SELECT 1 FROM public.coach_calendar_events WHERE id IN (pg_temp.e81id(580),pg_temp.e81id(590),pg_temp.e81id(591))),'Readback after switch-off and overlap: nothing changed');

DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.e81_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.e81_results;
 IF failures IS NOT NULL THEN
  RAISE EXCEPTION USING MESSAGE='Events switch failed',DETAIL=failures;
 END IF;
 RAISE NOTICE 'Events switch: % checks passed',n;
END $$;
SELECT count(*) AS events_switch_checks_passed FROM pg_temp.e81_results;
ROLLBACK;

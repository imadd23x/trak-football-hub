-- @trak-suite mode=--event-start-time in-all=true
-- TRAK-157 (J8.4), from the 11 Oct live run: 8 published trainings saved with
-- no time. Rule (Imad, 12 Oct): every event has a start time. Refused: a new
-- event without one, clearing it, publishing an event that has none. An event
-- from before the rule (prod has some) can still be cancelled or edited, and
-- can be given a time.
-- Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing event-start-time fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.s157id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('91570000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE s157_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON s157_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.s157actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.s157id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.s157check(ok boolean,label text,detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.s157_results VALUES(label,ok IS TRUE,detail)
$$;
-- The statement must succeed.
CREATE FUNCTION pg_temp.s157ok(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text; msg text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.s157_results VALUES(label, st IS NULL, coalesce(st||': '||msg,'ok'));
END $$;
-- The statement must be refused by the start-time rule.
CREATE FUNCTION pg_temp.s157refused(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text; msg text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.s157_results VALUES(label, st = '23514' AND msg = 'Select a start time: every event needs one.', coalesce(st||': '||msg,'no error'));
END $$;
-- An insert of one of the coach's events in 5 days, as the app writes it.
CREATE FUNCTION pg_temp.s157event(n integer, starts time, published boolean) RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published) VALUES (%L,%L,%L,%L,%L,%L,%L,%L)',
   pg_temp.s157id(n), pg_temp.s157id(10), 'Training '||n, 'training',
   (((now() AT TIME ZONE 'Asia/Dubai')::date + 5) + coalesce(starts, time '00:00')) AT TIME ZONE 'Asia/Dubai',
   (now() AT TIME ZONE 'Asia/Dubai')::date + 5, starts, published)
$$;
CREATE FUNCTION pg_temp.s157set(n integer, assignment text) RETURNS text LANGUAGE sql AS $$
 SELECT format('UPDATE public.coach_calendar_events SET %s WHERE id = %L', assignment, pg_temp.s157id(n))
$$;
SET LOCAL check_function_bodies = off;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy X (100): coach A (10).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.s157id(n), 'synthetic-'||n||'@starttime157.invalid', now() FROM unnest(ARRAY[1,10]) n;
INSERT INTO public.profiles(user_id,role,full_name)
 SELECT pg_temp.s157id(n), CASE WHEN n = 1 THEN 'club' ELSE 'coach' END::public.user_role, 'Synthetic '||n
 FROM unnest(ARRAY[1,10]) n;
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.s157id(100),pg_temp.s157id(1),'Start Time Academy X','S157X1');
INSERT INTO public.coach_details(user_id,organization_id,team) VALUES (pg_temp.s157id(10),pg_temp.s157id(100),'U15');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.s157id(100),'events') ON CONFLICT DO NOTHING;

-- Two events from before the rule, with no time: a published one (like the
-- live run's Tuesdays) and a draft.
ALTER TABLE public.coach_calendar_events DISABLE TRIGGER trg_refuse_event_without_start_time;
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published) VALUES
 (pg_temp.s157id(800),pg_temp.s157id(10),'Old live','training',(now() AT TIME ZONE 'Asia/Dubai')::date + 6,(now() AT TIME ZONE 'Asia/Dubai')::date + 6,NULL,true),
 (pg_temp.s157id(801),pg_temp.s157id(10),'Old draft','training',(now() AT TIME ZONE 'Asia/Dubai')::date + 7,(now() AT TIME ZONE 'Asia/Dubai')::date + 7,NULL,false),
 (pg_temp.s157id(802),pg_temp.s157id(10),'Old live 2','training',(now() AT TIME ZONE 'Asia/Dubai')::date + 8,(now() AT TIME ZONE 'Asia/Dubai')::date + 8,NULL,true);
ALTER TABLE public.coach_calendar_events ENABLE TRIGGER trg_refuse_event_without_start_time;

SET LOCAL ROLE authenticated;
SELECT pg_temp.s157actor(10);

-- ── 1. A new event needs a start time ──────────────────────────────────────
SELECT pg_temp.s157refused(pg_temp.s157event(700, NULL, false), '1 a draft with no start time is refused');
SELECT pg_temp.s157refused(pg_temp.s157event(701, NULL, true), '1 so is a published one');
SELECT pg_temp.s157ok(pg_temp.s157event(702, '18:00', false), '1 a draft with a start time saves');
SELECT pg_temp.s157ok(pg_temp.s157event(703, '17:00', true), '1 so does a published one');

-- ── 2. A start time can't be taken away ────────────────────────────────────
SELECT pg_temp.s157refused(pg_temp.s157set(702, 'start_time = NULL'), '2 clearing a draft''s start time is refused');
SELECT pg_temp.s157refused(pg_temp.s157set(703, 'start_time = NULL'), '2 so is clearing a live event''s');
SELECT pg_temp.s157ok(pg_temp.s157set(703, 'start_time = ''18:30'''), '2 moving it to another time is fine');

-- ── 3. An event from before the rule ───────────────────────────────────────
SELECT pg_temp.s157ok(pg_temp.s157set(800, 'venue = ''Pitch 4'''), '3 an old untimed event can still be edited');
SELECT pg_temp.s157ok(pg_temp.s157set(800, 'status = ''cancelled'', cancel_reason = ''Pitch closed'''), '3 and cancelled');
SELECT pg_temp.s157refused(pg_temp.s157set(801, 'published = true'), '3 an old untimed draft can''t be published without a time');
SELECT pg_temp.s157ok(pg_temp.s157set(801, 'start_time = ''17:00'', published = true'), '3 it publishes once it has one');
SELECT pg_temp.s157ok(pg_temp.s157set(802, 'start_time = ''16:00'''), '3 an old live event can be given a time');

-- ── 4. The operator too ────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.s157refused(pg_temp.s157event(710, NULL, true), '4 the service role can''t skip it either');
RESET ROLE;

SELECT pg_temp.s157check((SELECT count(*) = 0 FROM public.coach_calendar_events WHERE id IN (pg_temp.s157id(700), pg_temp.s157id(701), pg_temp.s157id(710))),
 '5 readback: no untimed event was written');
SELECT pg_temp.s157check((SELECT start_time = '18:30' FROM public.coach_calendar_events WHERE id = pg_temp.s157id(703)),
 '5 readback: the live event kept a start time');

DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.s157_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.s157_results;
 IF n <> 15 THEN
  RAISE EXCEPTION 'Event start time: % checks ran; expected exactly 15', n;
 END IF;
 IF failures IS NOT NULL THEN
  RAISE EXCEPTION USING MESSAGE='Event start time failed',DETAIL=failures;
 END IF;
END $$;
ROLLBACK;

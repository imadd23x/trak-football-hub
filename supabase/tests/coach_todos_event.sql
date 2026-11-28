-- @trak-suite mode=--coach-todos-event in-all=true
-- TRAK-621 (Other events → To-do 1/6): a coach's own to-do can be linked to one of their own events. Only to their own
-- event; one open to-do per event; a ticked one frees the event; a deleted draft event takes its to-do with it. Nobody
-- else reads or writes them. Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing coach-todos-event fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t621id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('96210000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t621_results(label text, ok boolean);
GRANT SELECT, INSERT ON t621_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.t621actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t621id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t621check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t621_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.t621refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.t621changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE FUNCTION pg_temp.t621link(title text, event integer) RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO public.coach_todos(title,due_on,calendar_event_id) VALUES(%L,%L,%L)', title, '2054-11-05', pg_temp.t621id(event))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Jürgen Klopp (10) and Pep Guardiola (11) coach; Thierry Henry (20) is a player.
-- Events: 100 and 102 (a draft) are Klopp's, 101 is Guardiola's.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t621id(n),'synthetic-'||n||'@todos621.invalid',now() FROM unnest(ARRAY[10,11,20]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t621id(10),'coach','Jürgen Klopp'),(pg_temp.t621id(11),'coach','Pep Guardiola'),
 (pg_temp.t621id(20),'player','Thierry Henry');
INSERT INTO public.player_details(user_id,date_of_birth) VALUES(pg_temp.t621id(20),'2000-01-01');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published) VALUES
 (pg_temp.t621id(100),pg_temp.t621id(10),'Drinks','other','2054-11-05 15:00+00','2054-11-05','19:00',true),
 (pg_temp.t621id(101),pg_temp.t621id(11),'Team photo','other','2054-11-06 13:00+00','2054-11-06','17:00',true),
 (pg_temp.t621id(102),pg_temp.t621id(10),'Kit handout','other','2054-11-07 13:00+00','2054-11-07','17:00',false);

SET LOCAL ROLE authenticated;

-- ── 1. A coach links a to-do to their own event ───────────────────────────
SELECT pg_temp.t621actor(10);
SELECT pg_temp.t621check(NOT pg_temp.t621refused(pg_temp.t621link('Invite the team · Drinks',100),'42501'),'1 a coach links a to-do to their own event');
SELECT pg_temp.t621check((SELECT calendar_event_id FROM public.coach_todos WHERE title='Invite the team · Drinks')=pg_temp.t621id(100),'1 and reads the link');
SELECT pg_temp.t621check(NOT pg_temp.t621refused(format('INSERT INTO public.coach_todos(title,due_on) VALUES(%L,%L)','Order new bibs','2054-11-05'),'42501'),'1 a to-do with no event still works');

-- ── 2. One open to-do per event ────────────────────────────────────────────
SELECT pg_temp.t621check(pg_temp.t621refused(pg_temp.t621link('Be there · Drinks',100),'23505'),'2 a second open to-do on the same event is refused');
SELECT pg_temp.t621check(pg_temp.t621changed('UPDATE public.coach_todos SET done_at=now() WHERE title=''Invite the team · Drinks''')=1,'2 the coach ticks it');
SELECT pg_temp.t621check(NOT pg_temp.t621refused(pg_temp.t621link('Be there · Drinks',100),'23505'),'2 then the event takes a new one');
SELECT pg_temp.t621check(pg_temp.t621refused('UPDATE public.coach_todos SET done_at=NULL WHERE title=''Invite the team · Drinks''','23505'),'2 un-ticking the old one while a new one is open is refused');

-- ── 3. Only to their own event ─────────────────────────────────────────────
SELECT pg_temp.t621check(pg_temp.t621refused(pg_temp.t621link('Not mine',101),'42501'),'3 linking to another coach''s event is refused');
SELECT pg_temp.t621check(pg_temp.t621refused(format('UPDATE public.coach_todos SET calendar_event_id=%L WHERE title=''Order new bibs''',pg_temp.t621id(101)),'42501'),'3 so is moving a to-do onto it');
SELECT pg_temp.t621actor(20);
SELECT pg_temp.t621check(pg_temp.t621refused(pg_temp.t621link('Mine',100),'42501'),'3 a player can''t link one');

-- ── 4. Nobody else reads them ──────────────────────────────────────────────
SELECT pg_temp.t621actor(11);
SELECT pg_temp.t621check(NOT EXISTS(SELECT 1 FROM public.coach_todos),'4 another coach reads none');
SELECT pg_temp.t621check(pg_temp.t621changed('UPDATE public.coach_todos SET done_at=now()')=0,'4 nor ticks any');
RESET ROLE;

-- ── 5. A deleted draft event takes its to-do with it ───────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.t621actor(10);
SELECT pg_temp.t621check(NOT pg_temp.t621refused(pg_temp.t621link('Bring or buy something · Kit handout',102),'42501'),'5 a to-do on a draft event');
RESET ROLE;
DELETE FROM public.coach_calendar_events WHERE id=pg_temp.t621id(102);
SELECT pg_temp.t621check(NOT EXISTS(SELECT 1 FROM public.coach_todos WHERE calendar_event_id=pg_temp.t621id(102) OR title LIKE '%Kit handout'),'5 goes when the draft is deleted');
SELECT pg_temp.t621check((SELECT count(*) FROM public.coach_todos WHERE coach_user_id=pg_temp.t621id(10))=3,'5 and the coach''s other to-dos stay');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.t621_results;
 IF total <> 15 THEN RAISE EXCEPTION 'Coach to-dos on events: % checks ran; expected 15', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.t621_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Coach to-dos on events checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Coach to-dos on events: % of % passed', total, total;
END $$;
ROLLBACK;

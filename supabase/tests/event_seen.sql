-- @trak-suite mode=--event-seen in-all=true
-- TRAK-580 (coach–player P03): a change families can see, made to a published event, asks each player on its squad to
-- see it again: one "seen" task per event and squad, raised to the event's change count on every such change. The
-- player records it by opening the event; another player can't. Publishing, a draft's edits, a change families can't
-- see and an academy with tasks switched off ask nothing. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing event-seen fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t580id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('95800000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t580_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON t580_results TO authenticated, anon;
CREATE FUNCTION pg_temp.t580actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t580id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t580check(ok boolean, label text, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t580_results VALUES(label, ok IS TRUE, detail)
$$;
CREATE FUNCTION pg_temp.t580refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- The event's seen tasks, as "squad:version" (superuser view).
CREATE FUNCTION pg_temp.t580tasks(event integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(string_agg(t.squad || ':' || t.source_version, ',' ORDER BY t.squad), '')
 FROM public.trak_tasks t WHERE t.source_type = 'event' AND t.source_id = pg_temp.t580id(event)
$$;
-- The caller's my_tasks() row for an event's seen task, as "answered/outdated", or "none".
CREATE FUNCTION pg_temp.t580state(event integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT m.answered || '/' || m.outdated FROM public.my_tasks() m
   WHERE m.source_type = 'event' AND m.source_id = pg_temp.t580id(event)), 'none')
$$;
-- Players can't read trak_tasks, so the ids are copied here (as superuser, after each change) for the calls below.
CREATE TEMP TABLE t580_kept(event integer, squad text, id uuid);
GRANT SELECT ON t580_kept TO authenticated, anon;
CREATE FUNCTION pg_temp.t580keep() RETURNS void LANGUAGE sql AS $$
 DELETE FROM pg_temp.t580_kept;
 INSERT INTO pg_temp.t580_kept SELECT right(t.source_id::text, 3)::integer, t.squad, t.id FROM public.trak_tasks t WHERE t.source_type = 'event';
$$;
CREATE FUNCTION pg_temp.t580task(event integer, squad text) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT k.id FROM pg_temp.t580_kept k WHERE k.event = $1 AND k.squad = $2
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Academy A (100), tasks on: Coach One (10) has U16 (Ola 20, Kai 21) and U14 (Zed 22). Academy B (101), tasks off:
-- Coach Three (12) has U16 (Max 24). All players are adults, so consent isn't the question here (P01 covers it).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t580id(n),'synthetic-'||n||'@seen580.invalid',now() FROM unnest(ARRAY[1,2,10,12,20,21,22,24]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t580id(1),'club','Synthetic Admin A'),(pg_temp.t580id(2),'club','Synthetic Admin B'),
 (pg_temp.t580id(10),'coach','Synthetic Coach One'),(pg_temp.t580id(12),'coach','Synthetic Coach Three'),
 (pg_temp.t580id(20),'player','Synthetic Player Ola'),(pg_temp.t580id(21),'player','Synthetic Player Kai'),
 (pg_temp.t580id(22),'player','Synthetic Player Zed'),(pg_temp.t580id(24),'player','Synthetic Player Max');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t580id(100),pg_temp.t580id(1),'Seen Academy A','T580A1'),(pg_temp.t580id(101),pg_temp.t580id(2),'Seen Academy B','T580B1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t580id(10),pg_temp.t580id(100)),(pg_temp.t580id(12),pg_temp.t580id(101));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.t580id(n), current_date - interval '20 years' FROM unnest(ARRAY[20,21,22,24]) n;
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.t580id(40),pg_temp.t580id(10),'Synthetic Player Ola','U16',pg_temp.t580id(20)),
 (pg_temp.t580id(41),pg_temp.t580id(10),'Synthetic Player Kai','U16',pg_temp.t580id(21)),
 (pg_temp.t580id(42),pg_temp.t580id(10),'Synthetic Player Zed','U14',pg_temp.t580id(22)),
 (pg_temp.t580id(44),pg_temp.t580id(12),'Synthetic Player Max','U16',pg_temp.t580id(24));
-- Academies start with tasks on (20261128200000). This suite switches it by hand, as an operator still can.
DELETE FROM public.academy_features WHERE feature = 'tasks';
INSERT INTO public.academy_features(organization_id,feature) VALUES
 (pg_temp.t580id(100),'events'),(pg_temp.t580id(101),'events'),(pg_temp.t580id(100),'tasks')
 ON CONFLICT DO NOTHING;
-- 800 a U16 match in 5 days, 801 a whole-roster training (no squad) in 6, 802 Academy B's U16 training in 5: all drafts.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published,squad) VALUES
 (pg_temp.t580id(800),pg_temp.t580id(10),'vs Parkview','match',now() + interval '5 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '5 days')::date,'18:00',false,'U16'),
 (pg_temp.t580id(801),pg_temp.t580id(10),' ','training',now() + interval '6 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '6 days')::date,'17:00',false,NULL),
 (pg_temp.t580id(802),pg_temp.t580id(12),'B training','training',now() + interval '5 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '5 days')::date,'17:00',false,'U16');
SELECT pg_temp.t580check((SELECT count(*) FROM public.coach_calendar_events WHERE coach_user_id IN (pg_temp.t580id(10),pg_temp.t580id(12))
    AND organization_id IS NOT NULL AND sequence = 0) = 3,
  '0 CONTROL three drafts in their coach''s academy at change 0');
SET LOCAL ROLE authenticated;

-- ── 1. A draft's edits and publishing ask nothing ──────────────────────────
SELECT pg_temp.t580actor(10);
UPDATE public.coach_calendar_events SET venue = 'Rehearsal Park' WHERE id = pg_temp.t580id(800);
UPDATE public.coach_calendar_events SET published = true WHERE id IN (pg_temp.t580id(800), pg_temp.t580id(801));
RESET ROLE;
SELECT pg_temp.t580check(pg_temp.t580tasks(800) = '' AND pg_temp.t580tasks(801) = ''
    AND (SELECT sequence FROM public.coach_calendar_events WHERE id = pg_temp.t580id(800)) = 2,
  '1 a draft''s edit and publishing ask nobody to see anything', pg_temp.t580tasks(800));
SET LOCAL ROLE authenticated;

-- ── 2. A change after publishing asks the squad ─────────────────────────────
SELECT pg_temp.t580actor(10);
UPDATE public.coach_calendar_events SET start_time = '19:00', starts_at = starts_at + interval '1 hour' WHERE id = pg_temp.t580id(800);
RESET ROLE;
SELECT pg_temp.t580keep();
SELECT pg_temp.t580check(pg_temp.t580tasks(800) = 'U16:3',
  '2 moving the published match asks its squad once, at the event''s change count', pg_temp.t580tasks(800));
SELECT pg_temp.t580check((SELECT t.answer_kind = 'seen' AND t.title = 'vs Parkview' AND t.status = 'open' AND t.squad_player_id IS NULL
    AND t.coach_user_id = pg_temp.t580id(10) AND t.organization_id = pg_temp.t580id(100)
    AND t.due_at = (SELECT e.starts_at FROM public.coach_calendar_events e WHERE e.id = pg_temp.t580id(800))
    FROM public.trak_tasks t WHERE t.id = pg_temp.t580task(800, 'U16')),
  '2 a squad "seen" task named after the event, from its coach and academy, open until it starts');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t580actor(20);
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'false/false'
    AND (SELECT m.answer_kind FROM public.my_tasks() m WHERE m.source_id = pg_temp.t580id(800)) = 'seen',
  '2 Ola has it, not yet seen', pg_temp.t580state(800));
SELECT pg_temp.t580actor(22);
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'none', '2 Zed, in U14, isn''t asked about a U16 match');

-- ── 3. Opening it records seen, for that player only ────────────────────────
SELECT pg_temp.t580actor(20);
SELECT public.respond_to_task(pg_temp.t580task(800, 'U16'));
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'true/false', '3 Ola''s seen is recorded');
SELECT public.respond_to_task(pg_temp.t580task(800, 'U16'));
RESET ROLE;
SELECT pg_temp.t580check((SELECT count(*) FROM public.task_responses WHERE task_id = pg_temp.t580task(800, 'U16')) = 1
    AND (SELECT source_version FROM public.task_responses WHERE task_id = pg_temp.t580task(800, 'U16')) = 3,
  '3 opening it again stores nothing new: one answer, at change 3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t580actor(21);
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'false/false', '3 Kai hasn''t seen it: Ola''s answer is hers alone');
SELECT pg_temp.t580actor(22);
SELECT pg_temp.t580check(pg_temp.t580refused(format('SELECT public.respond_to_task(%L)', pg_temp.t580task(800, 'U16')), '42501'),
  '3 Zed, on another squad, can''t record it');
SELECT pg_temp.t580actor(24);
SELECT pg_temp.t580check(pg_temp.t580refused(format('SELECT public.respond_to_task(%L)', pg_temp.t580task(800, 'U16')), '42501'),
  '3 Max, in another academy, can''t record it');

-- ── 4. The next change asks again ───────────────────────────────────────────
SELECT pg_temp.t580actor(10);
UPDATE public.coach_calendar_events SET venue = 'Parkview Ground' WHERE id = pg_temp.t580id(800);
RESET ROLE;
SELECT pg_temp.t580check(pg_temp.t580tasks(800) = 'U16:4', '4 a second change raises the same task to change 4', pg_temp.t580tasks(800));
SET LOCAL ROLE authenticated;
SELECT pg_temp.t580actor(20);
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'true/true', '4 Ola''s earlier seen is outdated', pg_temp.t580state(800));
SELECT public.respond_to_task(pg_temp.t580task(800, 'U16'));
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'true/false', '4 opening it again records the new change');

-- ── 5. What families can't see asks nothing; a cancellation asks ────────────
SELECT pg_temp.t580actor(10);
UPDATE public.coach_calendar_events SET competition = 'league' WHERE id = pg_temp.t580id(800);
RESET ROLE;
SELECT pg_temp.t580check(pg_temp.t580tasks(800) = 'U16:4'
    AND (SELECT sequence FROM public.coach_calendar_events WHERE id = pg_temp.t580id(800)) = 5,
  '5 a change families don''t read (the competition) moves the change count but asks nobody', pg_temp.t580tasks(800));
SET LOCAL ROLE authenticated;
SELECT pg_temp.t580actor(20);
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'true/false', '5 Ola stays seen');
SELECT pg_temp.t580actor(10);
UPDATE public.coach_calendar_events SET status = 'cancelled', cancel_reason = 'Pitch closed' WHERE id = pg_temp.t580id(800);
SELECT pg_temp.t580actor(20);
SELECT pg_temp.t580check(pg_temp.t580state(800) = 'true/true', '5 cancelling it asks Ola again', pg_temp.t580state(800));

-- ── 6. A whole-roster event asks every squad ────────────────────────────────
SELECT pg_temp.t580actor(10);
UPDATE public.coach_calendar_events SET family_note = 'Bring water.' WHERE id = pg_temp.t580id(801);
RESET ROLE;
SELECT pg_temp.t580keep();
SELECT pg_temp.t580check(pg_temp.t580tasks(801) = 'U14:2,U16:2', '6 an event for the whole roster asks each squad', pg_temp.t580tasks(801));
SELECT pg_temp.t580check((SELECT title FROM public.trak_tasks WHERE id = pg_temp.t580task(801, 'U14')) = 'Training',
  '6 an event with a blank title is named by its kind');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t580actor(22);
SELECT pg_temp.t580check(pg_temp.t580state(801) = 'false/false', '6 Zed (U14) has it');
SELECT pg_temp.t580actor(21);
SELECT pg_temp.t580check(pg_temp.t580state(801) = 'false/false', '6 Kai (U16) has it');

-- ── 7. Tasks switched off: nothing ──────────────────────────────────────────
SELECT pg_temp.t580actor(12);
UPDATE public.coach_calendar_events SET published = true WHERE id = pg_temp.t580id(802);
UPDATE public.coach_calendar_events SET venue = 'Elsewhere' WHERE id = pg_temp.t580id(802);
RESET ROLE;
SELECT pg_temp.t580check(pg_temp.t580tasks(802) = '', '7 an academy with tasks off gets no seen tasks', pg_temp.t580tasks(802));
SELECT pg_temp.t580check((SELECT venue FROM public.coach_calendar_events WHERE id = pg_temp.t580id(802)) = 'Elsewhere',
  '7 CONTROL the coach''s edit itself went through');

DO $$
DECLARE failed text;
BEGIN
 SELECT string_agg(label || coalesce(' [' || detail || ']', ''), '; ') INTO failed FROM pg_temp.t580_results WHERE NOT ok;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'Event-seen checks failed: %', failed; END IF;
 IF (SELECT count(*) FROM pg_temp.t580_results) < 23 THEN RAISE EXCEPTION 'Event seen: only % checks ran', (SELECT count(*) FROM pg_temp.t580_results); END IF;
END $$;
ROLLBACK;

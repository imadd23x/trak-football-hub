-- @trak-suite mode=--player-training-plans in-all=true
-- TRAK-601 (coach–player P13): a squad's players read their training's plan through my_training_plans(), never "Watch
-- for" (the coaching points) or the coach's note; another squad, another academy, a draft, a cancelled training and an
-- academy with tasks off read nothing. Each save asks the squad for one Got it, again after the next save. Publishing a
-- planned training asks, cancelling closes the ask, a new start time moves its end. The plan names the training's
-- register, so a past training links to it. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing player-training-plans fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t601id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('96010000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t601_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON t601_results TO authenticated, anon;
CREATE FUNCTION pg_temp.t601actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t601id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t601check(ok boolean, label text, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t601_results VALUES(label, ok IS TRUE, detail)
$$;
CREATE FUNCTION pg_temp.t601refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- What the caller reads of a training's plan, as "position:name" in order, or ''.
CREATE FUNCTION pg_temp.t601read(event integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(string_agg(p.position || ':' || p.name, ',' ORDER BY p.position), '')
 FROM public.my_training_plans() p WHERE p.event_id = pg_temp.t601id(event)
$$;
-- A training's plan tasks, as "squad:version:status" (superuser view).
CREATE FUNCTION pg_temp.t601tasks(event integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(string_agg(t.squad || ':' || t.source_version || ':' || t.status, ',' ORDER BY t.squad), '')
 FROM public.trak_tasks t WHERE t.source_type = 'training_plan' AND t.source_id = pg_temp.t601id(event)
$$;
-- The caller's my_tasks() row for a training's plan, as "answered/outdated", or "none".
CREATE FUNCTION pg_temp.t601state(event integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT m.answered || '/' || m.outdated FROM public.my_tasks() m
   WHERE m.source_type = 'training_plan' AND m.source_id = pg_temp.t601id(event)), 'none')
$$;
-- Players can't read trak_tasks, so the ids are copied here (as superuser) for the calls below.
CREATE TEMP TABLE t601_kept(event integer, squad text, id uuid);
GRANT SELECT ON t601_kept TO authenticated, anon;
CREATE FUNCTION pg_temp.t601keep() RETURNS void LANGUAGE sql AS $$
 DELETE FROM pg_temp.t601_kept;
 INSERT INTO pg_temp.t601_kept SELECT right(t.source_id::text, 3)::integer, t.squad, t.id FROM public.trak_tasks t WHERE t.source_type = 'training_plan';
$$;
CREATE FUNCTION pg_temp.t601task(event integer, squad text) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT k.id FROM pg_temp.t601_kept k WHERE k.event = $1 AND k.squad = $2
$$;
-- Two practices: one the coach wrote, one of Trak's drills at level 4. SECRET marks what players must never read.
CREATE FUNCTION pg_temp.t601plan(first_name text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_array(
  jsonb_build_object('name', first_name, 'minutes', 15, 'how', 'Groups of three, 10 m apart.', 'tell', 'SECRET watch for',
    'area', '20 x 20 m', 'part', 'Passing', 'part_type', 'passing', 'source', 'own'),
  jsonb_build_object('name', 'Tag games', 'minutes', 10, 'how', 'Two taggers.', 'tell', 'SECRET coaching point',
    'part', 'Warm-up', 'part_type', 'warmup', 'source', 'trak', 'trak_drill', 'lib-tag-games', 'trak_level', 4))
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Academy A (100), tasks and training on: Coach One (10) has U16 (Ola 20, Kai 21) and U14 (Zed 22). Academy B (101),
-- training on, tasks off: Coach Three (12) has U16 (Max 24). All players are adults, so consent isn't the question here.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t601id(n),'synthetic-'||n||'@plans601.invalid',now() FROM unnest(ARRAY[1,2,10,12,20,21,22,24]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t601id(1),'club','Synthetic Admin A'),(pg_temp.t601id(2),'club','Synthetic Admin B'),
 (pg_temp.t601id(10),'coach','Synthetic Coach One'),(pg_temp.t601id(12),'coach','Synthetic Coach Three'),
 (pg_temp.t601id(20),'player','Synthetic Player Ola'),(pg_temp.t601id(21),'player','Synthetic Player Kai'),
 (pg_temp.t601id(22),'player','Synthetic Player Zed'),(pg_temp.t601id(24),'player','Synthetic Player Max');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t601id(100),pg_temp.t601id(1),'Plans Academy A','T601A1'),(pg_temp.t601id(101),pg_temp.t601id(2),'Plans Academy B','T601B1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t601id(10),pg_temp.t601id(100)),(pg_temp.t601id(12),pg_temp.t601id(101));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.t601id(n), current_date - interval '20 years' FROM unnest(ARRAY[20,21,22,24]) n;
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.t601id(40),pg_temp.t601id(10),'Synthetic Player Ola','U16',pg_temp.t601id(20)),
 (pg_temp.t601id(41),pg_temp.t601id(10),'Synthetic Player Kai','U16',pg_temp.t601id(21)),
 (pg_temp.t601id(42),pg_temp.t601id(10),'Synthetic Player Zed','U14',pg_temp.t601id(22)),
 (pg_temp.t601id(44),pg_temp.t601id(12),'Synthetic Player Max','U16',pg_temp.t601id(24));
-- Academies start with tasks on (20261128200000). This suite switches it by hand, as an operator still can.
DELETE FROM public.academy_features WHERE feature = 'tasks';
INSERT INTO public.academy_features(organization_id,feature) VALUES
 (pg_temp.t601id(100),'events'),(pg_temp.t601id(101),'events'),(pg_temp.t601id(100),'training'),
 (pg_temp.t601id(101),'training'),(pg_temp.t601id(100),'tasks')
 ON CONFLICT DO NOTHING;
-- 900 a published U16 training in 5 days, 901 a draft U16 training in 6, 902 Academy B's published U16 training in 5.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published,squad) VALUES
 (pg_temp.t601id(900),pg_temp.t601id(10),'Finishing','training',now() + interval '5 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '5 days')::date,'18:00',true,'U16'),
 (pg_temp.t601id(901),pg_temp.t601id(10),' ','training',now() + interval '6 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '6 days')::date,'17:00',false,'U16'),
 (pg_temp.t601id(902),pg_temp.t601id(12),'B training','training',now() + interval '5 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '5 days')::date,'17:00',true,'U16');
SELECT pg_temp.t601check((SELECT count(*) FROM public.coach_calendar_events WHERE coach_user_id IN (pg_temp.t601id(10),pg_temp.t601id(12))
    AND organization_id IS NOT NULL) = 3, '0 CONTROL three trainings in their coach''s academy');
SET LOCAL ROLE authenticated;

-- ── 1. The squad reads the plan, never what's for the coach ─────────────────
SELECT pg_temp.t601actor(10);
SELECT public.save_training_plan(pg_temp.t601id(900), pg_temp.t601plan('Triangle passing'), 'SECRET coach note');
SELECT public.save_training_plan(pg_temp.t601id(901), pg_temp.t601plan('Draft passing'), '');
SELECT pg_temp.t601actor(20);
SELECT pg_temp.t601check(pg_temp.t601read(900) = '1:Triangle passing,2:Tag games', '1 Ola reads her squad''s plan, in order',
  pg_temp.t601read(900));
SELECT pg_temp.t601check((SELECT p.part = 'Passing' AND p.minutes = 15 AND p.how = 'Groups of three, 10 m apart.' AND p.area = '20 x 20 m'
    AND p.trak_drill IS NULL AND p.event_date = (SELECT ce.event_date FROM public.child_events(pg_temp.t601id(20)) ce WHERE ce.id = pg_temp.t601id(900))
    FROM public.my_training_plans() p WHERE p.event_id = pg_temp.t601id(900) AND p.position = 1),
  '1 a practice reads its part, minutes, set-up and details, on the training''s day');
SELECT pg_temp.t601check((SELECT p.trak_drill = 'lib-tag-games' AND p.trak_level = 4
    FROM public.my_training_plans() p WHERE p.event_id = pg_temp.t601id(900) AND p.position = 2),
  '1 a Trak drill reads which drill and its level, for the diagram');
SELECT pg_temp.t601check(NOT EXISTS (SELECT 1 FROM public.my_training_plans() p WHERE row_to_json(p)::text LIKE '%SECRET%'),
  '1 no row carries Watch for or the coach''s note');
SELECT pg_temp.t601check((SELECT NOT (proargnames && ARRAY['tell', 'note', 'source', 'drill_id', 'library_session'])
    FROM pg_proc WHERE oid = 'public.my_training_plans()'::regprocedure),
  '1 the read has no column for Watch for, the note or where a practice came from');
SELECT pg_temp.t601check(pg_temp.t601read(901) = '', '1 a draft training''s plan isn''t read');
SELECT pg_temp.t601actor(21);
SELECT pg_temp.t601check(pg_temp.t601read(900) = '1:Triangle passing,2:Tag games', '1 Kai, in the same squad, reads it too');
SELECT pg_temp.t601actor(22);
SELECT pg_temp.t601check(pg_temp.t601read(900) = '', '1 Zed, in U14, reads nothing of a U16 training');
SELECT pg_temp.t601actor(24);
SELECT pg_temp.t601check(pg_temp.t601read(900) = '', '1 Max, in another academy, reads nothing');
SELECT pg_temp.t601actor(10);
SELECT pg_temp.t601check(pg_temp.t601read(900) = '', '1 the coach reads nothing here: it''s the players'' read');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.t601check(pg_temp.t601refused('SELECT * FROM public.my_training_plans()', '42501'), '1 signed out, it can''t be called');
RESET ROLE;

-- ── 2. A save asks the squad for one Got it ─────────────────────────────────
SELECT pg_temp.t601keep();
SELECT pg_temp.t601check(pg_temp.t601tasks(900) = 'U16:1:open' AND pg_temp.t601tasks(901) = '',
  '2 the published training''s plan asks its squad once; the draft''s asks nobody', pg_temp.t601tasks(900));
SELECT pg_temp.t601check((SELECT t.answer_kind = 'got_it' AND t.title = 'Training plan: Finishing' AND t.squad_player_id IS NULL
    AND t.coach_user_id = pg_temp.t601id(10) AND t.organization_id = pg_temp.t601id(100)
    AND t.due_at = (SELECT e.starts_at FROM public.coach_calendar_events e WHERE e.id = pg_temp.t601id(900))
    FROM public.trak_tasks t WHERE t.id = pg_temp.t601task(900, 'U16')),
  '2 a squad Got it named after the training, from its coach and academy, open until it starts');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t601actor(20);
SELECT pg_temp.t601check(pg_temp.t601state(900) = 'false/false', '2 Ola is asked', pg_temp.t601state(900));
SELECT public.respond_to_task(pg_temp.t601task(900, 'U16'));
SELECT pg_temp.t601check(pg_temp.t601state(900) = 'true/false', '2 her Got it is recorded');
SELECT pg_temp.t601actor(21);
SELECT pg_temp.t601check(pg_temp.t601state(900) = 'false/false', '2 Kai isn''t answered for: Ola''s answer is hers alone');
SELECT pg_temp.t601actor(22);
SELECT pg_temp.t601check(pg_temp.t601state(900) = 'none', '2 Zed isn''t asked');

-- ── 3. The next save asks again ─────────────────────────────────────────────
SELECT pg_temp.t601actor(10);
SELECT public.save_training_plan(pg_temp.t601id(900), pg_temp.t601plan('Pass and move'), '');
SELECT pg_temp.t601actor(20);
SELECT pg_temp.t601check(pg_temp.t601read(900) = '1:Pass and move,2:Tag games', '3 Ola reads the changed plan');
SELECT pg_temp.t601check(pg_temp.t601state(900) = 'true/true', '3 her earlier Got it is outdated', pg_temp.t601state(900));
RESET ROLE;
SELECT pg_temp.t601check(pg_temp.t601tasks(900) = 'U16:2:open', '3 the same task, raised to version 2', pg_temp.t601tasks(900));

-- ── 4. Publishing a planned training asks; a new start moves the end ────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.t601actor(10);
UPDATE public.coach_calendar_events SET published = true WHERE id = pg_temp.t601id(901);
UPDATE public.coach_calendar_events SET starts_at = starts_at + interval '1 hour', start_time = '19:00' WHERE id = pg_temp.t601id(900);
RESET ROLE;
SELECT pg_temp.t601check(pg_temp.t601tasks(901) = 'U16:1:open'
    AND (SELECT title FROM public.trak_tasks WHERE source_type = 'training_plan' AND source_id = pg_temp.t601id(901)) = 'Training plan: Training',
  '4 publishing a training with a plan asks its squad, named by its kind when untitled', pg_temp.t601tasks(901));
SELECT pg_temp.t601check((SELECT t.due_at = e.starts_at FROM public.trak_tasks t JOIN public.coach_calendar_events e ON e.id = t.source_id
    WHERE t.source_type = 'training_plan' AND t.source_id = pg_temp.t601id(900)) AND pg_temp.t601tasks(900) = 'U16:2:open',
  '4 moving the training moves the Got it''s end, without asking again');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t601actor(20);
SELECT pg_temp.t601check(pg_temp.t601read(901) = '1:Draft passing,2:Tag games', '4 once published, Ola reads its plan');

-- ── 5. Cancelling closes it ─────────────────────────────────────────────────
SELECT pg_temp.t601actor(10);
UPDATE public.coach_calendar_events SET status = 'cancelled', cancel_reason = 'Pitch closed' WHERE id = pg_temp.t601id(901);
SELECT pg_temp.t601actor(20);
SELECT pg_temp.t601check(pg_temp.t601read(901) = '' AND pg_temp.t601state(901) = 'none',
  '5 a cancelled training''s plan and Got it are gone for Ola');
RESET ROLE;
SELECT pg_temp.t601check(pg_temp.t601tasks(901) = 'U16:1:closed', '5 its task is closed', pg_temp.t601tasks(901));

-- ── 6. Tasks switched off: nothing ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.t601actor(12);
SELECT public.save_training_plan(pg_temp.t601id(902), pg_temp.t601plan('B passing'), '');
SELECT pg_temp.t601actor(24);
SELECT pg_temp.t601check(pg_temp.t601read(902) = '', '6 Max reads no plan where tasks are off');
RESET ROLE;
SELECT pg_temp.t601check(pg_temp.t601tasks(902) = '', '6 and is asked nothing', pg_temp.t601tasks(902));
SELECT pg_temp.t601check(EXISTS (SELECT 1 FROM public.training_plans WHERE event_id = pg_temp.t601id(902)),
  '6 CONTROL the coach''s plan itself was saved');

-- ── 7. The plan names the training's register ────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.t601actor(20);
SELECT pg_temp.t601check((SELECT bool_and(p.session_id IS NULL) FROM public.my_training_plans() p WHERE p.event_id = pg_temp.t601id(900)),
  '7 before its register, the plan names none');
RESET ROLE;
INSERT INTO public.coach_sessions (id, coach_user_id, session_type, title, notes, session_date, event_id) VALUES
 (pg_temp.t601id(950), pg_temp.t601id(10), 'training', 'SECRET register title', 'SECRET register note', current_date - 1, pg_temp.t601id(900));
SET LOCAL ROLE authenticated;
SELECT pg_temp.t601actor(20);
SELECT pg_temp.t601check((SELECT bool_and(p.session_id = pg_temp.t601id(950)) FROM public.my_training_plans() p WHERE p.event_id = pg_temp.t601id(900)),
  '7 once the coach takes the register, the plan names it, as Ola''s past trainings do');
SELECT pg_temp.t601check(NOT EXISTS (SELECT 1 FROM public.my_training_plans() p WHERE row_to_json(p)::text LIKE '%SECRET%'),
  '7 and nothing of the register itself');
RESET ROLE;

DO $$
DECLARE failed text;
BEGIN
 SELECT string_agg(label || coalesce(' [' || detail || ']', ''), '; ') INTO failed FROM pg_temp.t601_results WHERE NOT ok;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'Player training plan checks failed: %', failed; END IF;
 IF (SELECT count(*) FROM pg_temp.t601_results) < 32 THEN RAISE EXCEPTION 'Player training plans: only % checks ran', (SELECT count(*) FROM pg_temp.t601_results); END IF;
END $$;
ROLLBACK;

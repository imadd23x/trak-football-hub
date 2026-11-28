-- @trak-suite mode=--tasks-and-responses in-all=true
-- TRAK-578 (coach–player P01): a coach sends a task to a squad or one player; each player answers their own copy with
-- the answer it asks for, and can undo it until the due time. Nobody answers another player's copy, a coach answers
-- nothing, and nothing is open with consent missing, off the roster, in another academy or with the switch off. A
-- newer source version asks a Got it again and keeps a Done. No app role touches the tables directly.
-- Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing task fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t578id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('95780000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t578_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON t578_results TO authenticated, anon;
CREATE TEMP TABLE t578_kept(name text PRIMARY KEY, id uuid);
GRANT SELECT, INSERT ON t578_kept TO authenticated, anon;
CREATE FUNCTION pg_temp.t578actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t578id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t578check(ok boolean, label text, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t578_results VALUES(label, ok IS TRUE, detail)
$$;
-- True only when the statement fails with exactly this SQLSTATE: a failure for any other reason proves nothing.
CREATE FUNCTION pg_temp.t578refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.t578task(name text) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM pg_temp.t578_kept WHERE t578_kept.name = $1
$$;
-- The caller's my_tasks() row for a kept task, as "answered/outdated", or "none".
CREATE FUNCTION pg_temp.t578state(name text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT m.answered || '/' || m.outdated FROM public.my_tasks() m WHERE m.task_id = pg_temp.t578task(name)), 'none')
$$;
CREATE FUNCTION pg_temp.t578count() RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT count(*) FROM public.my_tasks()
$$;
CREATE FUNCTION pg_temp.t578call(fn text, name text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT format('SELECT public.%s(%L)', fn, pg_temp.t578task(name))
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Academy A (100): Coach One (10) has U16: Ola (40, adult, 20), Kai (42, 14, parent 30, consent) and Leo (46, 14, no
-- consent, 26). Coach Two (11) is in A with no U16. Academy B (101): Coach Three (12) has a U16 too, with Max (44, adult,
-- 24). Nia (25, adult) joins Coach One's U16 later. Both academies have the tasks switch on.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t578id(n),'synthetic-'||n||'@task578.invalid',now() FROM unnest(ARRAY[1,2,10,11,12,20,22,24,25,26,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t578id(1),'club','Synthetic Admin A'),(pg_temp.t578id(2),'club','Synthetic Admin B'),
 (pg_temp.t578id(10),'coach','Synthetic Coach One'),(pg_temp.t578id(11),'coach','Synthetic Coach Two'),
 (pg_temp.t578id(12),'coach','Synthetic Coach Three'),
 (pg_temp.t578id(20),'player','Synthetic Player Ola'),(pg_temp.t578id(22),'player','Synthetic Player Kai'),
 (pg_temp.t578id(24),'player','Synthetic Player Max'),(pg_temp.t578id(25),'player','Synthetic Player Nia'),
 (pg_temp.t578id(26),'player','Synthetic Player Leo'),
 (pg_temp.t578id(30),'parent','Synthetic Parent Kai');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t578id(100),pg_temp.t578id(1),'Task Academy A','T578A1'),(pg_temp.t578id(101),pg_temp.t578id(2),'Task Academy B','T578B1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t578id(10),pg_temp.t578id(100)),(pg_temp.t578id(11),pg_temp.t578id(100)),(pg_temp.t578id(12),pg_temp.t578id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.t578id(20), current_date - interval '20 years'),(pg_temp.t578id(22), current_date - interval '14 years'),
 (pg_temp.t578id(24), current_date - interval '20 years'),(pg_temp.t578id(25), current_date - interval '20 years'),
 (pg_temp.t578id(26), current_date - interval '14 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES (pg_temp.t578id(22),pg_temp.t578id(30));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.t578id(40),pg_temp.t578id(10),'Synthetic Player Ola','U16',pg_temp.t578id(20)),
 (pg_temp.t578id(42),pg_temp.t578id(10),'Synthetic Player Kai','U16',pg_temp.t578id(22)),
 (pg_temp.t578id(46),pg_temp.t578id(10),'Synthetic Player Leo','U16',pg_temp.t578id(26)),
 (pg_temp.t578id(44),pg_temp.t578id(12),'Synthetic Player Max','U16',pg_temp.t578id(24));
-- Academies start with tasks on (20261128200000). This suite switches it by hand, as an operator still can.
DELETE FROM public.academy_features WHERE feature = 'tasks';
INSERT INTO public.academy_features(organization_id,feature) VALUES (pg_temp.t578id(100),'tasks'),(pg_temp.t578id(101),'tasks');
UPDATE public.organizations SET time_zone = 'Europe/Athens' WHERE id = pg_temp.t578id(101);
SELECT pg_temp.t578check((SELECT count(*) FROM public.squad_players WHERE id IN (pg_temp.t578id(40),pg_temp.t578id(42),pg_temp.t578id(46))
    AND organization_id = pg_temp.t578id(100) AND status = 'active') = 3,
  '0 CONTROL the roster rows carry their coach''s academy and are active');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(30);
SELECT public.record_parental_consent(pg_temp.t578id(22), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');

-- ── 1. A coach sends tasks; each player sees their own ─────────────────────
SELECT pg_temp.t578actor(10);
INSERT INTO pg_temp.t578_kept SELECT 'squad-got-it', public.create_task('U16', NULL, 'got_it', 'Read the plan for Tuesday', current_date + 2);
INSERT INTO pg_temp.t578_kept SELECT 'squad-done', public.create_task(' U16 ', NULL, 'done', 'Bring your shin pads', current_date + 3);
INSERT INTO pg_temp.t578_kept SELECT 'ola-review', public.create_task('U16', pg_temp.t578id(40), 'ready_for_review', 'Your first touch', current_date + 4);
INSERT INTO pg_temp.t578_kept SELECT 'squad-no-due', public.create_task('U16', NULL, 'got_it', 'Kit day is Friday', current_date + 5);
SELECT pg_temp.t578actor(12);
INSERT INTO pg_temp.t578_kept SELECT 'b-squad', public.create_task('U16', NULL, 'got_it', 'Academy B squad task', current_date + 2);
-- A task can also have no due time (a later feature's); this one stands for it.
RESET ROLE;
UPDATE public.trak_tasks SET due_at = NULL WHERE id = pg_temp.t578task('squad-no-due');
SELECT pg_temp.t578check((SELECT due_at FROM public.trak_tasks WHERE id = pg_temp.t578task('squad-got-it')) = (current_date + 3)::timestamp AT TIME ZONE 'Asia/Dubai'
    AND (SELECT due_at FROM public.trak_tasks WHERE id = pg_temp.t578task('b-squad')) = (current_date + 3)::timestamp AT TIME ZONE 'Europe/Athens',
  '1 a task is due at the end of its day on its academy''s clock (Dubai, Athens)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(20);
SELECT pg_temp.t578check(pg_temp.t578count() = 4 AND pg_temp.t578state('ola-review') = 'false/false',
  '1 Ola sees the three squad tasks and her own', pg_temp.t578count()::text);
SELECT pg_temp.t578check((SELECT array_agg(m.task_id ORDER BY ord) FROM public.my_tasks() WITH ORDINALITY m(task_id,title,source_type,source_id,answer_kind,due_at,time_zone,answered,outdated,ord))
    = ARRAY[pg_temp.t578task('squad-got-it'),pg_temp.t578task('squad-done'),pg_temp.t578task('ola-review'),pg_temp.t578task('squad-no-due')],
  '1 soonest due first, no due time last');
SELECT pg_temp.t578check((SELECT m.time_zone = 'Asia/Dubai' AND m.source_type = 'manual' AND m.title = 'Bring your shin pads'
    FROM public.my_tasks() m WHERE m.task_id = pg_temp.t578task('squad-done')),
  '1 a row has the academy''s time zone, the source and the title as sent (squad name trimmed)');
SELECT pg_temp.t578actor(22);
SELECT pg_temp.t578check(pg_temp.t578count() = 3 AND pg_temp.t578state('ola-review') = 'none',
  '1 Kai sees the squad tasks, never Ola''s own task');
SELECT pg_temp.t578actor(24);
SELECT pg_temp.t578check(pg_temp.t578count() = 1 AND pg_temp.t578state('b-squad') = 'false/false',
  '1 Max, in academy B, sees only his own squad''s task');

-- ── 2. A player answers and undoes their own copy ───────────────────────────
SELECT pg_temp.t578actor(20);
SELECT public.respond_to_task(pg_temp.t578task('squad-got-it'));
SELECT public.respond_to_task(pg_temp.t578task('squad-done'), pg_temp.t578id(20));
SELECT public.respond_to_task(pg_temp.t578task('ola-review'));
SELECT pg_temp.t578check(pg_temp.t578state('squad-got-it') = 'true/false' AND pg_temp.t578state('squad-done') = 'true/false'
    AND pg_temp.t578state('ola-review') = 'true/false',
  '2 Ola''s answers show as answered');
RESET ROLE;
SELECT pg_temp.t578check((SELECT responder_user_id = pg_temp.t578id(20) AND squad_player_id = pg_temp.t578id(40) AND source_version = 1
    FROM public.task_responses WHERE task_id = pg_temp.t578task('squad-got-it')),
  '2 the answer row records Ola as the responder, on her own roster row');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(20);
SELECT public.undo_task_response(pg_temp.t578task('squad-got-it'));
SELECT pg_temp.t578check(pg_temp.t578state('squad-got-it') = 'false/false', '2 Undo takes the answer back');
SELECT public.respond_to_task(pg_temp.t578task('squad-got-it'));
SELECT pg_temp.t578actor(22);
SELECT public.respond_to_task(pg_temp.t578task('squad-got-it'));
SELECT pg_temp.t578check(pg_temp.t578state('squad-got-it') = 'true/false' AND pg_temp.t578state('squad-done') = 'false/false',
  '2 Kai answers his own copy of a squad task; Ola''s answer to another task isn''t his');

-- ── 3. Nobody answers someone else's copy ───────────────────────────────────
SELECT pg_temp.t578check(pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'ola-review'), '42501')
    AND pg_temp.t578refused(pg_temp.t578call('undo_task_response', 'ola-review'), '42501'),
  '3 Kai can''t answer or undo Ola''s own task');
SELECT pg_temp.t578check(pg_temp.t578refused(format('SELECT public.respond_to_task(%L, %L)', pg_temp.t578task('squad-done'), pg_temp.t578id(20)), '42501'),
  '3 Kai can''t answer a squad task in Ola''s name');
SELECT pg_temp.t578actor(10);
SELECT pg_temp.t578check(pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'squad-got-it'), '42501')
    AND pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'ola-review'), '42501')
    AND pg_temp.t578count() = 0,
  '3 the coach answers nothing and has no copies');
SELECT pg_temp.t578actor(30);
SELECT pg_temp.t578check((SELECT count(*) FROM public.my_tasks(pg_temp.t578id(22))) = 0
    AND pg_temp.t578refused(format('SELECT public.respond_to_task(%L, %L)', pg_temp.t578task('squad-done'), pg_temp.t578id(22)), '42501'),
  '3 a parent reads and answers nothing yet (players only)');
SELECT pg_temp.t578actor(24);
SELECT pg_temp.t578check(pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'squad-done'), '42501')
    AND pg_temp.t578state('squad-done') = 'none',
  '3 a player in another academy can''t see or answer academy A''s task');
SELECT pg_temp.t578actor(12);
SELECT pg_temp.t578check(pg_temp.t578count() = 0, '3 a coach in another academy reads nothing');
-- A task stamped with another academy (e.g. its coach moved academies) is not the squad's, even with the same coach.
RESET ROLE;
UPDATE public.trak_tasks SET organization_id = pg_temp.t578id(101) WHERE id = pg_temp.t578task('squad-no-due');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(20);
SELECT pg_temp.t578check(pg_temp.t578state('squad-no-due') = 'none'
    AND pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'squad-no-due'), '42501'),
  '3 a task from another academy is never a player''s copy');
RESET ROLE;
UPDATE public.trak_tasks SET organization_id = pg_temp.t578id(100) WHERE id = pg_temp.t578task('squad-no-due');
SELECT pg_temp.t578check((SELECT count(*) FROM public.task_responses) = 4, '3 CONTROL only the four answers above were stored',
  (SELECT count(*) FROM public.task_responses)::text);
SET LOCAL ROLE authenticated;

-- ── 4. Nothing after the due time ───────────────────────────────────────────
RESET ROLE;
UPDATE public.trak_tasks SET due_at = now() - interval '1 minute' WHERE id = pg_temp.t578task('ola-review');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(20);
SELECT pg_temp.t578check(pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'ola-review'), '42501')
    AND pg_temp.t578refused(pg_temp.t578call('undo_task_response', 'ola-review'), '42501'),
  '4 after the due time Ola can neither answer nor undo');
SELECT pg_temp.t578check(pg_temp.t578state('ola-review') = 'none' AND pg_temp.t578count() = 3,
  '4 a task past its due time leaves My tasks');

-- ── 5. A newer version asks Got it again and keeps Done ─────────────────────
RESET ROLE;
UPDATE public.trak_tasks SET source_version = 2 WHERE id IN (pg_temp.t578task('squad-got-it'), pg_temp.t578task('squad-done'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(20);
SELECT pg_temp.t578check(pg_temp.t578state('squad-got-it') = 'true/true' AND pg_temp.t578state('squad-done') = 'true/false',
  '5 after an update, Got it is outdated and Done is kept',
  pg_temp.t578state('squad-got-it') || ' ' || pg_temp.t578state('squad-done'));
SELECT public.respond_to_task(pg_temp.t578task('squad-got-it'));
SELECT pg_temp.t578check(pg_temp.t578state('squad-got-it') = 'true/false', '5 answering again clears outdated');

-- ── 6. Consent withdrawn ────────────────────────────────────────────────────
SELECT pg_temp.t578actor(30);
SELECT public.withdraw_parental_consent(pg_temp.t578id(22));
SELECT pg_temp.t578actor(22);
SELECT pg_temp.t578check(pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'squad-done'), '42501')
    AND pg_temp.t578refused(pg_temp.t578call('undo_task_response', 'squad-got-it'), '42501')
    AND pg_temp.t578count() = 0,
  '6 with consent withdrawn Kai can''t answer or undo, and My tasks is empty');
RESET ROLE;
SELECT pg_temp.t578check(EXISTS (SELECT 1 FROM public.task_responses WHERE squad_player_id = pg_temp.t578id(42)),
  '6 Kai''s earlier answer is kept');
SET LOCAL ROLE authenticated;

-- ── 7. Joining and leaving the roster ───────────────────────────────────────
-- The academy's roster load does these, not a signed-in user: no claims, so the roster triggers treat it as such.
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.t578id(45),pg_temp.t578id(10),'Synthetic Player Nia','U16',pg_temp.t578id(25));
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(25);
SELECT pg_temp.t578check(pg_temp.t578count() = 3 AND pg_temp.t578state('squad-done') = 'false/false'
    AND pg_temp.t578state('ola-review') = 'none',
  '7 Nia joins and sees the squad''s open tasks, not Ola''s own and nothing past due');
SELECT public.respond_to_task(pg_temp.t578task('squad-done'));
SELECT pg_temp.t578check(pg_temp.t578state('squad-done') = 'true/false', '7 Nia answers her copy');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.squad_players SET status = 'released' WHERE id = pg_temp.t578id(40);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(20);
SELECT pg_temp.t578check(pg_temp.t578count() = 0 AND pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'squad-no-due'), '42501'),
  '7 Ola leaves the roster and stops seeing the squad''s tasks');
RESET ROLE;
SELECT pg_temp.t578check((SELECT count(*) FROM public.task_responses WHERE squad_player_id = pg_temp.t578id(40)) = 3,
  '7 Ola''s earlier answers stay');
SET LOCAL ROLE authenticated;

-- ── 8. What a coach can send ────────────────────────────────────────────────
SELECT pg_temp.t578actor(11);
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, ''got_it'', ''Not my squad'', current_date + 1)', '42501'),
  '8 a coach without that squad can''t send it a task');
SELECT pg_temp.t578actor(12);
SELECT pg_temp.t578check(pg_temp.t578refused(format('SELECT public.create_task(''U16'', %L, ''got_it'', ''Not my player'', current_date + 1)', pg_temp.t578id(42)), '42501'),
  '8 a coach in another academy can''t send a task to academy A''s player, even with a squad of the same name');
SELECT pg_temp.t578actor(10);
SELECT pg_temp.t578check(pg_temp.t578refused(format('SELECT public.create_task(''U16'', %L, ''got_it'', ''Waiting for consent'', current_date + 1)', pg_temp.t578id(46)), '42501'),
  '8 a task for a player waiting for consent is refused');
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, ''seen'', ''A silent one'', current_date + 1)', '22023')
    AND pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, NULL, ''No answer'', current_date + 1)', '22023'),
  '8 a coach asks for Got it, Done or Ready for review, never seen');
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, ''done'', ''Too late'', (now() AT TIME ZONE ''Asia/Dubai'')::date - 1)', '22023'),
  '8 a day already past on the academy''s clock is refused');
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, ''done'', ''No day'', NULL)', '22023'),
  '8 a manual task always has a day');
INSERT INTO pg_temp.t578_kept SELECT 'today', public.create_task('U16', NULL, 'done', 'Due today', (now() AT TIME ZONE 'Asia/Dubai')::date);
RESET ROLE;
SELECT pg_temp.t578check((SELECT due_at FROM public.trak_tasks WHERE id = pg_temp.t578task('today')) = ((now() AT TIME ZONE 'Asia/Dubai')::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai',
  '8 today on the academy''s clock is allowed, open until the academy''s midnight');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(10);
SELECT pg_temp.t578check(pg_temp.t578refused(format('SELECT public.create_task(''U16'', NULL, ''done'', %L, current_date + 1)', repeat('x', 81)), '23514')
    AND pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, ''done'', ''   '', current_date + 1)', '23514'),
  '8 a title is 1 to 80 characters');
SELECT pg_temp.t578actor(22);
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, ''done'', ''From a player'', current_date + 1)', '42501'),
  '8 a player can''t send a task');

-- ── 9. The switch ───────────────────────────────────────────────────────────
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.t578id(100) AND feature = 'tasks';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t578actor(10);
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT public.create_task(''U16'', NULL, ''done'', ''Switched off'', current_date + 1)', '42501'),
  '9 with the switch off the coach can''t send a task');
SELECT pg_temp.t578actor(25);
SELECT pg_temp.t578check(pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'squad-got-it'), '42501')
    AND pg_temp.t578refused(pg_temp.t578call('undo_task_response', 'squad-done'), '42501')
    AND pg_temp.t578count() = 0,
  '9 with the switch off a player can''t answer or undo, and My tasks is empty');
SELECT pg_temp.t578actor(24);
SELECT pg_temp.t578check(pg_temp.t578count() = 1, '9 CONTROL academy B''s switch is still on');

-- ── 10. No direct access to the tables ──────────────────────────────────────
SELECT pg_temp.t578check(NOT has_table_privilege('authenticated', 'public.trak_tasks', 'SELECT, INSERT, UPDATE, DELETE')
    AND NOT has_table_privilege('authenticated', 'public.task_responses', 'SELECT, INSERT, UPDATE, DELETE')
    AND NOT has_table_privilege('anon', 'public.trak_tasks', 'SELECT, INSERT, UPDATE, DELETE')
    AND NOT has_table_privilege('anon', 'public.task_responses', 'SELECT, INSERT, UPDATE, DELETE'),
  '10 neither app role has any privilege on either table');
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT count(*) FROM public.trak_tasks', '42501')
    AND pg_temp.t578refused(format('INSERT INTO public.task_responses(task_id,squad_player_id,responder_user_id,source_version) VALUES (%L,%L,%L,9)',
      pg_temp.t578task('b-squad'), pg_temp.t578id(44), pg_temp.t578id(24)), '42501'),
  '10 a signed-in player reads and writes neither table directly');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.t578check(pg_temp.t578refused('SELECT * FROM public.my_tasks()', '42501')
    AND pg_temp.t578refused(pg_temp.t578call('respond_to_task', 'b-squad'), '42501'),
  '10 a visitor who isn''t signed in can''t call the functions');
RESET ROLE;

DO $$
DECLARE failed text;
BEGIN
 SELECT string_agg(label || coalesce(' [' || detail || ']', ''), '; ') INTO failed FROM pg_temp.t578_results WHERE NOT ok;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'Task checks failed: %', failed; END IF;
 IF (SELECT count(*) FROM pg_temp.t578_results) < 44 THEN RAISE EXCEPTION 'Tasks: only % checks ran', (SELECT count(*) FROM pg_temp.t578_results); END IF;
END $$;
ROLLBACK;

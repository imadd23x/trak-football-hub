-- @trak-suite mode=--season-evaluations in-all=true
-- TRAK-364 (Season plan 16/18, spec TRAK-348): the evaluation. A squad's plan has a rhythm (every 2 weeks, every month
-- or every 6 weeks, on a day); once the plan is shared, a new rhythm waits under Not shared yet as 'evaluation'. The
-- coach publishes an evaluation through publish_evaluation() only: one assessment per consented player of the squad,
-- with the six ratings, no session, published at once, and the note as the player's message. All or nothing: a
-- player who can't be recorded refuses the whole evaluation and nothing is written. One evaluation per date, not in
-- the future and after the last. The note: the player reads it, a guardian never does, while the guardian still sees
-- the bands. Only the plan's coach reads the evaluations, and only publish_evaluation() puts an assessment in one.
-- Other coaches, other academies, admins, players, guardians and anon publish nothing. Synthetic fixtures; the suite
-- rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing season-evaluation fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.ev364id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93640000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE ev364_results(label text, ok boolean);
GRANT SELECT, INSERT ON ev364_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.ev364actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ev364id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.ev364check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.ev364_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.ev364refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.ev364count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
CREATE FUNCTION pg_temp.ev364changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
-- The academy's day (Asia/Dubai, the default), which due dates are counted in.
CREATE FUNCTION pg_temp.ev364today() RETURNS date LANGUAGE sql STABLE AS $$
 SELECT (now() AT TIME ZONE 'Asia/Dubai')::date
$$;
-- One player's entry: six ratings from a base, and an optional note.
CREATE FUNCTION pg_temp.ev364player(n integer, base integer DEFAULT 6, note text DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('squad_player_id', pg_temp.ev364id(n), 'work_rate', base, 'tactical', base + 1,
   'attitude', base, 'technical', base + 2, 'physical', base - 1, 'coachability', base, 'note', note))
$$;
-- A publish, as SQL text, for the refusal checks.
CREATE FUNCTION pg_temp.ev364publish(plan integer, due date, players jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('SELECT public.publish_evaluation(%L, %L, %L::jsonb)', pg_temp.ev364id(plan), due, players)
$$;
-- How many evaluations and assessments exist, read as the owner: nothing changes when a publish is refused.
CREATE FUNCTION pg_temp.ev364written() RETURNS text LANGUAGE sql AS $$
 SELECT (SELECT count(*) FROM public.season_evaluations)::text || '/' ||
   (SELECT count(*) FROM public.coach_assessments WHERE squad_player_id::text LIKE '93640000-%')::text || '/' ||
   (SELECT count(*) FROM public.coach_shared_feedback f JOIN public.coach_assessments a ON a.id = f.assessment_id
     WHERE a.squad_player_id::text LIKE '93640000-%')::text
$$;
CREATE TEMP TABLE ev364_published(result jsonb);
GRANT SELECT, INSERT ON ev364_published TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy On (100) has the season plan; Academy Off (101) hasn't. Admin On (1) runs both.
-- Coach One (10, On), U16: Pat (squad 40, child 20, under 18, consent from guardian Gina 30), Quinn (41, child 21, under
-- 18, guardian Gus 31 hasn't consented), Ola (44, adult 23); U14: Uri (46, adult 25). Coach Two (11, On), U16: Rae
-- (42, adult 22). Coach Three (12, Off), U16: Sam (43, adult 24).
-- Plans: Coach One's U16 (50, shared) and U14 (53, a draft); Coach Two's U16 (51, shared); Coach Three's U16 (52,
-- shared). Each season runs from 60 days ago to 200 days ahead.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.ev364id(n),'synthetic-'||n||'@evaluation364.invalid',now() FROM unnest(ARRAY[1,10,11,12,20,21,22,23,24,25,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.ev364id(1),'club','Synthetic Admin On'),
 (pg_temp.ev364id(10),'coach','Synthetic Coach One'),(pg_temp.ev364id(11),'coach','Synthetic Coach Two'),
 (pg_temp.ev364id(12),'coach','Synthetic Coach Three'),
 (pg_temp.ev364id(20),'player','Synthetic Player Pat'),(pg_temp.ev364id(21),'player','Synthetic Player Quinn'),
 (pg_temp.ev364id(22),'player','Synthetic Player Rae'),(pg_temp.ev364id(23),'player','Synthetic Player Ola'),
 (pg_temp.ev364id(24),'player','Synthetic Player Sam'),(pg_temp.ev364id(25),'player','Synthetic Player Uri'),
 (pg_temp.ev364id(30),'parent','Synthetic Guardian Gina'),(pg_temp.ev364id(31),'parent','Synthetic Guardian Gus');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.ev364id(100),pg_temp.ev364id(1),'Evaluation On Academy','E364N1'),
 (pg_temp.ev364id(101),pg_temp.ev364id(1),'Evaluation Off Academy','E364F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.ev364id(10),pg_temp.ev364id(100)),(pg_temp.ev364id(11),pg_temp.ev364id(100)),(pg_temp.ev364id(12),pg_temp.ev364id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.ev364id(20),current_date - interval '12 years'),(pg_temp.ev364id(21),current_date - interval '12 years'),
 (pg_temp.ev364id(22),current_date - interval '20 years'),(pg_temp.ev364id(23),current_date - interval '20 years'),
 (pg_temp.ev364id(24),current_date - interval '20 years'),(pg_temp.ev364id(25),current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.ev364id(20),pg_temp.ev364id(30)),(pg_temp.ev364id(21),pg_temp.ev364id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.ev364id(40),pg_temp.ev364id(10),'Synthetic Player Pat','U16',pg_temp.ev364id(20),'Defender'),
 (pg_temp.ev364id(41),pg_temp.ev364id(10),'Synthetic Player Quinn','U16',pg_temp.ev364id(21),'Midfielder'),
 (pg_temp.ev364id(44),pg_temp.ev364id(10),'Synthetic Player Ola','U16',pg_temp.ev364id(23),'Attacker'),
 (pg_temp.ev364id(46),pg_temp.ev364id(10),'Synthetic Player Uri','U14',pg_temp.ev364id(25),'Midfielder'),
 (pg_temp.ev364id(42),pg_temp.ev364id(11),'Synthetic Player Rae','U16',pg_temp.ev364id(22),'Attacker'),
 (pg_temp.ev364id(43),pg_temp.ev364id(12),'Synthetic Player Sam','U16',pg_temp.ev364id(24),'Defender');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.ev364id(100),'season_plan');
INSERT INTO public.season_plans(id,coach_user_id,squad,starts_on,ends_on) VALUES
 (pg_temp.ev364id(50),pg_temp.ev364id(10),'U16',pg_temp.ev364today() - 60,pg_temp.ev364today() + 200),
 (pg_temp.ev364id(53),pg_temp.ev364id(10),'U14',pg_temp.ev364today() - 60,pg_temp.ev364today() + 200),
 (pg_temp.ev364id(51),pg_temp.ev364id(11),'U16',pg_temp.ev364today() - 60,pg_temp.ev364today() + 200),
 (pg_temp.ev364id(52),pg_temp.ev364id(12),'U16',pg_temp.ev364today() - 60,pg_temp.ev364today() + 200);
-- Shared a month ago, as share_season_plan() leaves a plan.
UPDATE public.season_plans SET shared_at = now() - interval '30 days', last_shared_at = now() - interval '30 days'
 WHERE id IN (pg_temp.ev364id(50), pg_temp.ev364id(51), pg_temp.ev364id(52));

-- Consent through the guardian's own function, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(30);
SELECT public.record_parental_consent(pg_temp.ev364id(20), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
RESET ROLE;

-- 1. The rhythm.
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.season_plans WHERE id = %L AND eval_every = ''month'' AND eval_day = 0', pg_temp.ev364id(50))) = 1,
  '1 a plan evaluates every month, on the last Sunday, until the coach says otherwise');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(10);
SELECT pg_temp.ev364check(pg_temp.ev364changed(format('UPDATE public.season_plans SET eval_every = ''2w'', eval_day = 6 WHERE id = %L', pg_temp.ev364id(53))) = 1,
  '1 the coach sets a draft''s rhythm');
SELECT pg_temp.ev364check(pg_temp.ev364refused(format('UPDATE public.season_plans SET eval_every = ''weekly'' WHERE id = %L', pg_temp.ev364id(53)), '23514')
  AND pg_temp.ev364refused(format('UPDATE public.season_plans SET eval_day = 7 WHERE id = %L', pg_temp.ev364id(53)), '23514'),
  '1 only every 2 weeks, every month or every 6 weeks, on a day of the week');
UPDATE public.season_plans SET eval_every = '6w' WHERE id = pg_temp.ev364id(50);
UPDATE public.season_plans SET eval_day = 3 WHERE id = pg_temp.ev364id(50);
RESET ROLE;
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.season_plans WHERE id = %L AND unshared_parts = ''{}''', pg_temp.ev364id(53))) = 1,
  '1 a draft''s rhythm waits for nothing');
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.season_plans WHERE id = %L AND unshared_parts = ''{evaluation}'' AND eval_every = ''6w'' AND eval_day = 3',
  pg_temp.ev364id(50))) = 1, '1 once shared, a new rhythm waits under Not shared yet, listed once');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(10);
SELECT pg_temp.ev364check(pg_temp.ev364refused(format('UPDATE public.season_plans SET unshared_parts = ''{}'' WHERE id = %L', pg_temp.ev364id(50)), '42501'),
  '1 the coach can''t clear what waits to be shared');
SELECT public.share_season_plan(pg_temp.ev364id(50));
RESET ROLE;
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.season_plans WHERE id = %L AND unshared_parts = ''{}''', pg_temp.ev364id(50))) = 1,
  '1 sharing the changes shares the rhythm');

-- 2. Who can't publish, and what holds an evaluation back. Nothing is written by any of it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(11);
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44))), '42501')
  AND pg_temp.ev364refused(pg_temp.ev364publish(99, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(42))), '42501'),
  '2 another coach can''t publish the plan''s evaluation, and a made-up plan is refused the same way');
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(51, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44))), '42501'),
  '2 a coach can''t evaluate another coach''s player');
SELECT pg_temp.ev364actor(12);
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(52, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(43))), '42501'),
  '2 switched off, a coach can''t publish');
SELECT pg_temp.ev364actor(1);
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44))), '42501'),
  '2 the academy admin can''t publish');
SELECT pg_temp.ev364actor(20);
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(40))), '42501'),
  '2 the player can''t publish');
SELECT pg_temp.ev364actor(30);
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(40))), '42501'),
  '2 the guardian can''t publish');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(40))), '42501'),
  '2 anon can''t publish');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(10);
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(53, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(46))), 'P0001'),
  '2 a plan that isn''t shared has no evaluation');
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today() + 1, jsonb_build_array(pg_temp.ev364player(44))), 'P0001')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, NULL, jsonb_build_array(pg_temp.ev364player(44))), 'P0001'),
  '2 an evaluation due tomorrow, in the academy''s day, isn''t due yet');
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today() - 61, jsonb_build_array(pg_temp.ev364player(44))), 'P0001'),
  '2 a date before the season isn''t one of its evaluations');
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(),
    jsonb_build_array(pg_temp.ev364player(44), pg_temp.ev364player(41))), '42501'),
  '2 a child waiting for a parent refuses the whole evaluation');
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(),
    jsonb_build_array(pg_temp.ev364player(44), pg_temp.ev364player(46))), '22023'),
  '2 a player from the coach''s other squad isn''t in this evaluation');
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44, 10))), '22023')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44) || '{"physical": 5.5}'::jsonb)), '22023')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44) || '{"tactical": "7"}'::jsonb)), '22023')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44) - 'coachability')), '22023'),
  '2 six whole ratings from 0 to 10, every one of them');
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44, 6, repeat('x', 301)))), '22023')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), jsonb_build_array(pg_temp.ev364player(44), pg_temp.ev364player(44))), '22023')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), '[]'::jsonb), '22023')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today(), '{}'::jsonb), '22023'),
  '2 a note of up to 300 characters, each player once, and at least one player');
RESET ROLE;
SELECT pg_temp.ev364check(pg_temp.ev364written() = '0/0/0', '2 a refused publish writes nothing at all');

-- 3. Publishing: one assessment per player, no session, published, the note as the player's message.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(10);
INSERT INTO pg_temp.ev364_published SELECT public.publish_evaluation(pg_temp.ev364id(50), pg_temp.ev364today() - 3,
  jsonb_build_array(pg_temp.ev364player(40, 7, '  Well done this month, Pat.  '), pg_temp.ev364player(44, 4)));
RESET ROLE;
SELECT pg_temp.ev364check(pg_temp.ev364written() = '1/2/1'
  AND (SELECT jsonb_array_length(result -> 'assessments') = 2 AND result ->> 'due_on' = (pg_temp.ev364today() - 3)::text FROM pg_temp.ev364_published),
  '3 one evaluation, an assessment for each player, one note; it says which assessment is whose');
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.season_evaluations e WHERE e.id = %L AND e.plan_id = %L AND e.due_on = %L AND e.published_by = %L AND e.published_at = now()',
  (SELECT result ->> 'evaluation_id' FROM pg_temp.ev364_published), pg_temp.ev364id(50), pg_temp.ev364today() - 3, pg_temp.ev364id(10))) = 1,
  '3 the evaluation records its plan, the date it closes, who published it and when');
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.coach_assessments a WHERE a.evaluation_id = %L AND a.session_id IS NULL AND a.appearance IS NULL
     AND a.published_at = now() AND a.coach_user_id = %L AND a.coach_name_snapshot = ''Synthetic Coach One'' AND a.organization_id = %L',
  (SELECT result ->> 'evaluation_id' FROM pg_temp.ev364_published), pg_temp.ev364id(10), pg_temp.ev364id(100))) = 2,
  '3 each is the coach''s assessment, published, in the academy, with no session and no appearance');
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.coach_assessments a WHERE a.squad_player_id = %L AND a.evaluation_id IS NOT NULL
     AND (a.work_rate, a.tactical, a.attitude, a.technical, a.physical, a.coachability) = (7, 8, 7, 9, 6, 7)
     AND (a.consistency, a.impact, a.workrate, a.technique, a.spirit) = (7, 9, 7, 9, 7) AND a.coach_rating = 7.3',
  pg_temp.ev364id(40))) = 1
  AND pg_temp.ev364count(format(
  'SELECT count(*) FROM public.coach_assessments a WHERE a.squad_player_id = %L AND (a.work_rate, a.tactical, a.attitude, a.technical, a.physical, a.coachability) = (4, 5, 4, 6, 3, 4)
     AND a.technique = 6 AND a.spirit = 4', pg_temp.ev364id(44))) = 1,
  '3 the six ratings as entered, the card stats from them, and the band''s average');
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.coach_shared_feedback f JOIN public.coach_assessments a ON a.id = f.assessment_id
     WHERE a.squad_player_id = %L AND f.body = ''Well done this month, Pat.'' AND f.published_at = now() AND f.coach_user_id = %L',
  pg_temp.ev364id(40), pg_temp.ev364id(10))) = 1,
  '3 the note is Pat''s message, trimmed and published; Ola, with none, has no message');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(10);
SELECT pg_temp.ev364check(pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today() - 3, jsonb_build_array(pg_temp.ev364player(44))), 'P0001')
  AND pg_temp.ev364refused(pg_temp.ev364publish(50, pg_temp.ev364today() - 10, jsonb_build_array(pg_temp.ev364player(44))), 'P0001'),
  '3 the same date again, or an earlier one, is already published: a retry never doubles it');
RESET ROLE;
SELECT pg_temp.ev364check(pg_temp.ev364written() = '1/2/1', '3 and the refused retry wrote nothing');

-- 4. Who reads what. The note: the player reads it; a guardian never does, while seeing the bands.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(30);
SELECT pg_temp.ev364check(pg_temp.ev364count(format(
  'SELECT count(*) FROM public.coach_assessments WHERE squad_player_id = %L AND evaluation_id IS NOT NULL AND work_rate = 7', pg_temp.ev364id(40))) = 1,
  '4 Pat''s guardian sees the evaluation''s bands, as any published assessment''s');
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.coach_shared_feedback') = 0
  AND pg_temp.ev364count(format('SELECT count(*) FROM public.coach_shared_feedback f WHERE f.assessment_id IN
    (SELECT a.id FROM public.coach_assessments a WHERE a.squad_player_id = %L)', pg_temp.ev364id(40))) = 0,
  '4 Pat''s guardian never reads the note');
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.season_evaluations') = 0, '4 nor the evaluation');
SELECT pg_temp.ev364actor(31);
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.coach_shared_feedback') = 0
  AND pg_temp.ev364count('SELECT count(*) FROM public.coach_assessments') = 0, '4 another child''s guardian reads none of it');
SELECT pg_temp.ev364actor(20);
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.coach_shared_feedback WHERE body = ''Well done this month, Pat.''') = 1,
  '4 Pat reads the note');
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.season_evaluations') = 0, '4 a player doesn''t read the evaluation itself');
SELECT pg_temp.ev364actor(23);
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.coach_shared_feedback') = 0
  AND pg_temp.ev364count('SELECT count(*) FROM public.coach_assessments') = 1, '4 Ola reads her own assessment and nobody''s note');
SELECT pg_temp.ev364actor(10);
SELECT pg_temp.ev364check(pg_temp.ev364count(format('SELECT count(*) FROM public.season_evaluations WHERE plan_id = %L', pg_temp.ev364id(50))) = 1,
  '4 the coach reads their evaluation');
SELECT pg_temp.ev364actor(11);
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.season_evaluations') = 0, '4 another coach doesn''t');
SELECT pg_temp.ev364actor(1);
SELECT pg_temp.ev364check(pg_temp.ev364count('SELECT count(*) FROM public.season_evaluations') = 0
  AND pg_temp.ev364count('SELECT count(*) FROM public.coach_shared_feedback') = 0, '4 nor the academy admin, who reads no note either');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ev364check(pg_temp.ev364refused('SELECT count(*) FROM public.season_evaluations', '42501'), '4 anon reads nothing');
RESET ROLE;

-- 5. Only publish_evaluation() puts an assessment in an evaluation, and nobody writes an evaluation.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev364actor(10);
SELECT pg_temp.ev364check(pg_temp.ev364refused(format(
  'INSERT INTO public.coach_assessments(coach_user_id, squad_player_id, evaluation_id) VALUES(%L, %L, %L)',
  pg_temp.ev364id(10), pg_temp.ev364id(44), (SELECT result ->> 'evaluation_id' FROM pg_temp.ev364_published)), '42501'),
  '5 the coach can''t write an assessment into an evaluation');
SELECT pg_temp.ev364check(pg_temp.ev364refused(format(
  'UPDATE public.coach_assessments SET evaluation_id = NULL WHERE squad_player_id = %L', pg_temp.ev364id(44)), '42501'),
  '5 nor take one out of it');
SELECT pg_temp.ev364check(pg_temp.ev364changed(format(
  'UPDATE public.coach_assessments SET physical = 4 WHERE squad_player_id = %L AND evaluation_id IS NOT NULL', pg_temp.ev364id(44))) = 1
  AND pg_temp.ev364changed(format(
  'INSERT INTO public.coach_assessments(coach_user_id, squad_player_id) VALUES(%L, %L)', pg_temp.ev364id(10), pg_temp.ev364id(44))) = 1,
  '5 an evaluation''s assessment edits as any other, and a session-less assessment still saves as before');
SELECT pg_temp.ev364check(pg_temp.ev364refused(format(
  'INSERT INTO public.season_evaluations(plan_id, due_on) VALUES(%L, %L)', pg_temp.ev364id(50), pg_temp.ev364today()), '42501')
  AND pg_temp.ev364refused(format('UPDATE public.season_evaluations SET due_on = due_on - 1 WHERE plan_id = %L', pg_temp.ev364id(50)), '42501')
  AND pg_temp.ev364refused(format('DELETE FROM public.season_evaluations WHERE plan_id = %L', pg_temp.ev364id(50)), '42501'),
  '5 the coach never writes, moves or deletes an evaluation');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.ev364_results;
 IF total <> 44 THEN RAISE EXCEPTION 'Season evaluations: % checks ran; expected 44', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.ev364_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Season evaluation checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Season evaluations: % of % passed', total, total;
END $$;
ROLLBACK;

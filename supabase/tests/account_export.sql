-- @trak-suite mode=--account-export-review in-all=true
-- Execute against a DISPOSABLE database after replaying migrations.
-- The harness must SET trak.test_database = 'disposable'. All fixtures roll back.
--
-- GDPR Article 20 — export_my_account().
--
-- The assertion that matters here is NOT "the export contained the subject's
-- data". A function that returned every row in the database would pass that,
-- and pass it impressively. The load-bearing assertion is the negative:
-- **it contained ONLY theirs** — and every negative below is paired with a
-- positive control, so a suite of zero-row results cannot pass by the identity
-- being wrong and nothing matching anything.
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to run export fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Assertion failed: %', description;
  END IF;
END;
$test$;

-- ── Fixtures: two children under one coach, so "only theirs" is testable ──

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('11111111-0000-0000-0000-000000000001', 'coach@export.test',  now()),
  ('11111111-0000-0000-0000-000000000002', 'childA@export.test', now()),
  ('11111111-0000-0000-0000-000000000003', 'childB@export.test', now()),
  ('11111111-0000-0000-0000-000000000004', 'parent@export.test', now());

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('11111111-0000-0000-0000-000000000001', 'coach',  'Export Coach'),
  ('11111111-0000-0000-0000-000000000002', 'player', 'Child A'),
  ('11111111-0000-0000-0000-000000000003', 'player', 'Child B'),
  ('11111111-0000-0000-0000-000000000004', 'parent', 'Export Parent');

INSERT INTO public.player_details (user_id, position) VALUES
  ('11111111-0000-0000-0000-000000000002', 'Midfielder'),
  ('11111111-0000-0000-0000-000000000003', 'Defender');

-- Academy membership must exist before roster insertion so pinned ownership
-- records the original academy. Use real removal later, not a status-only mock.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('11111111-0000-0000-0000-000000000005','admin@export.test',now());
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 ('11111111-0000-0000-0000-000000000005','club','Export Academy Admin');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 ('44444444-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000005','Export Academy','EXPORT-ACADEMY');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 ('11111111-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000001');

-- Both children on the same coach's roster.
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name, status) VALUES
  ('22222222-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000002', 'Child A', 'active'),
  ('22222222-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000003', 'Child B', 'released');

INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id, work_rate) VALUES
  ('33333333-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 9),
  ('33333333-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-00000000000b',
   '11111111-0000-0000-0000-000000000001', 2);

-- The coach's private note on Child A. Must never reach a player's export.
INSERT INTO public.coach_assessment_notes (assessment_id, coach_user_id, note) VALUES
  ('33333333-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
   'PRIVATE-COACH-NOTE-CANARY');

INSERT INTO public.recognition_awards(id,coach_user_id,squad_player_id,award_type,note) VALUES
 ('55555555-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-00000000000a','player_of_week','FORMER-ACADEMY-AWARD');

-- One match each, so "only mine" is distinguishable from "none".
--
-- team_score is set deliberately rather than left to its default of 0.
-- @imadd23x caught this on review: #76 added
-- matches_goals_within_team_score (goals <= team_score), and Child A's row
-- scored a goal in a match the fixture said finished 0-0. The constraint was
-- right and the fixture was wrong — a player cannot score more than their team
-- did, and this suite had been asserting an export of an impossible record
-- since before the rule existed.
--
-- Child B's row keeps goals = 0 and takes a score anyway, so the two rows are
-- not accidentally symmetrical: the canary that matters is the OPPONENT name,
-- and both must survive the constraints for the "only mine" assertions to mean
-- anything.
--
-- minutes_played is set for the same reason, and it is a SECOND violation the
-- review did not reach: matches_no_minutes_no_contribution refuses goals or
-- assists from a player with no minutes, and minutes_played also defaults to
-- 0. The first constraint aborted the insert before the second could fire, so
-- fixing only team_score moved the failure rather than removing it. Both rows
-- now describe a match somebody could actually have played.
INSERT INTO public.matches
  (user_id, opponent, match_date, position, competition, venue, age_group,
   team_score, opponent_score, minutes_played, goals, assists) VALUES
  ('11111111-0000-0000-0000-000000000002', 'CHILD-A-OPPONENT', current_date,
   'mid', 'League', 'Home', 'U15', 2, 1, 90, 1, 0),
  ('11111111-0000-0000-0000-000000000003', 'CHILD-B-OPPONENT', current_date,
   'def', 'League', 'Away', 'U15', 0, 3, 90, 0, 1);


-- ── 1. Child A exports ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}', true);

CREATE TEMP TABLE export_a AS SELECT public.export_my_account() AS doc;

-- POSITIVE CONTROL. Without this, every "does not contain" below would pass
-- for an export that is simply empty.
SELECT pg_temp.assert_true(
  (SELECT doc->'profile'->>'full_name' FROM export_a) = 'Child A',
  'positive control: the export identifies Child A');

SELECT pg_temp.assert_true(
  (SELECT doc::text FROM export_a) LIKE '%CHILD-A-OPPONENT%',
  'positive control: Child A''s own match is present');

-- THE assertion. Child B is on the same coach's roster.
SELECT pg_temp.assert_true(
  (SELECT doc::text FROM export_a) NOT LIKE '%CHILD-B-OPPONENT%',
  'Child A''s export does not contain Child B''s match');

SELECT pg_temp.assert_true(
  (SELECT doc::text FROM export_a) NOT LIKE '%Child B%',
  'Child A''s export does not name Child B');

-- K9: coach-private notes never reach a player, whatever the scope switch says.
SELECT pg_temp.assert_true(
  (SELECT doc::text FROM export_a) NOT LIKE '%PRIVATE-COACH-NOTE-CANARY%',
  'a player''s export never contains a coach''s private note');

-- Observations about the subject, gated on the declared scope.
SELECT pg_temp.assert_true(
  CASE WHEN public.export_scope_includes_observations()
       THEN jsonb_array_length((SELECT doc->'coach_assessments' FROM export_a)) = 1
       ELSE (SELECT doc FROM export_a) ? 'coach_assessments' = false
  END,
  'assessments about the player follow export_scope_includes_observations()');

-- And only the assessment on THEIR roster row, not the other child's.
SELECT pg_temp.assert_true(
  NOT public.export_scope_includes_observations()
  OR (SELECT (doc->'coach_assessments'->0->>'work_rate')::int FROM export_a) = 9,
  'the assessment exported is the one about Child A, not Child B');

-- The document says what it covers.
SELECT pg_temp.assert_true(
  (SELECT doc->'scope'->>'never_included' FROM export_a) IS NOT NULL
  AND (SELECT doc->'scope' FROM export_a) ? 'includes_observations_about_you',
  'the export states its own scope to the subject');

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);


-- ── 2. The coach exports ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

CREATE TEMP TABLE export_c AS SELECT public.export_my_account() AS doc;

SELECT pg_temp.assert_true(
  (SELECT doc->'profile'->>'full_name' FROM export_c) = 'Export Coach',
  'positive control: the export identifies the coach');

-- The coach's own work product, including their private notes: they wrote them.
SELECT pg_temp.assert_true(
  (SELECT doc::text FROM export_c) LIKE '%PRIVATE-COACH-NOTE-CANARY%',
  'a coach''s export DOES contain their own private notes');

SELECT pg_temp.assert_true(
  jsonb_array_length((SELECT doc->'squad_players' FROM export_c)) = 2,
  'the coach''s export contains both roster rows — that is the coach''s record');

SELECT pg_temp.assert_true(jsonb_array_length((SELECT doc->'recognition_awards' FROM export_c))=1,
 'positive control: current coach exports own authorized award');

-- But not the children's own logs. Those are the children's.
SELECT pg_temp.assert_true(
  (SELECT doc::text FROM export_c) NOT LIKE '%CHILD-A-OPPONENT%'
  AND (SELECT doc::text FROM export_c) NOT LIKE '%CHILD-B-OPPONENT%',
  'a coach''s export does not contain the children''s own match logs');

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);


-- U8: an export must not reopen the former academy after real removal.
-- The removal RPC is closed to app roles while the academy console is parked
-- (#134, TRAK-47), so the operator runs it with the academy admin's identity;
-- its own admin check still applies. Everything the coach does is app-role.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT public.remove_coach_from_org('11111111-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.squad_players WHERE id IN
 ('22222222-0000-0000-0000-00000000000a','22222222-0000-0000-0000-00000000000b')),
 'departure control: former roster is inaccessible through ordinary RLS');
CREATE TEMP TABLE export_departed AS SELECT public.export_my_account() AS doc;
SELECT pg_temp.assert_true((SELECT doc->'profile'->>'full_name' FROM export_departed)='Export Coach',
 'departure control: own profile remains exportable');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'squad_players') FROM export_departed)=0,
 'removed coach export excludes former academy roster');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'coach_assessments') FROM export_departed)=0,
 'removed coach export excludes former academy assessments');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'coach_assessment_notes') FROM export_departed)=0,
 'removed coach export excludes former academy private notes');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'recognition_awards') FROM export_departed)=0,
 'removed coach export excludes former academy awards');
RESET ROLE;
SELECT set_config('request.jwt.claims',NULL,true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.squad_players WHERE organization_id='44444444-0000-0000-0000-000000000001')=2,
 'history remains retained at original academy');

-- Transfer to a new academy must not recover the old pinned rows, including
-- a released row whose status the removal RPC deliberately leaves unchanged.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('11111111-0000-0000-0000-000000000006','admin2@export.test',now());
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 ('11111111-0000-0000-0000-000000000006','club','Second Export Admin');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 ('44444444-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000006','Second Export Academy','EXPORT-SECOND');
-- Academy membership is set by the operator (TRAK-12: no code-join, no
-- self-chosen academy), so the transfer is the operator's update.
UPDATE public.coach_details SET organization_id = '44444444-0000-0000-0000-000000000002'
WHERE user_id = '11111111-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claims',NULL,true);
INSERT INTO public.squad_players(id,coach_user_id,player_name,status) VALUES
 ('22222222-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000001','New Academy Adult','active');
INSERT INTO public.coach_assessments(id,squad_player_id,coach_user_id,work_rate) VALUES
 ('33333333-0000-0000-0000-00000000000c','22222222-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000001',7);
INSERT INTO public.coach_assessment_notes(assessment_id,coach_user_id,note) VALUES
 ('33333333-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000001','CURRENT-ACADEMY-NOTE');
INSERT INTO public.recognition_awards(id,coach_user_id,squad_player_id,award_type,note) VALUES
 ('55555555-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-00000000000c','player_of_week','CURRENT-ACADEMY-AWARD');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}',true);
CREATE TEMP TABLE export_transferred AS SELECT public.export_my_account() AS doc;
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'squad_players')=1
 AND doc->'squad_players'->0->>'id'='22222222-0000-0000-0000-00000000000c' FROM export_transferred),
 'transfer exports only current academy roster, not released old rows');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'coach_assessments')=1
 AND doc->'coach_assessments'->0->>'id'='33333333-0000-0000-0000-00000000000c' FROM export_transferred),
 'transfer exports only current academy assessments');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'coach_assessment_notes')=1
 AND doc->'coach_assessment_notes'->0->>'note'='CURRENT-ACADEMY-NOTE' FROM export_transferred),
 'transfer preserves current private note without former private note');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(doc->'recognition_awards')=1
 AND doc->'recognition_awards'->0->>'note'='CURRENT-ACADEMY-AWARD' FROM export_transferred),
 'transfer preserves current award without former award');
RESET ROLE;
SELECT set_config('request.jwt.claims',NULL,true);

-- ── 3. An unauthenticated caller gets nothing ───────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', NULL, true);

DO $test$
BEGIN
  PERFORM public.export_my_account();
  RAISE EXCEPTION 'Assertion failed: export_my_account() succeeded with no auth.uid()';
EXCEPTION
  WHEN sqlstate 'P0001' THEN
    IF SQLERRM LIKE '%Assertion failed%' THEN RAISE; END IF;
    -- 'Not authenticated' is the expected refusal.
END;
$test$;

RESET ROLE;

-- ── 4. anon cannot execute it at all ────────────────────────────────────
SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.export_my_account()', 'EXECUTE'),
  'anon holds no EXECUTE on export_my_account()');

SELECT pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.export_my_account()', 'EXECUTE'),
  'positive control: authenticated CAN execute it');

ROLLBACK;

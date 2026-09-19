-- @trak-suite mode=--coach-notes-review in-all=true
-- Execute against a DISPOSABLE database after replaying migrations.
-- The harness must SET trak.test_database = 'disposable' on this connection.
-- These tests execute real RLS under the authenticated role; no mocks.
-- All fixtures are rolled back.
--
-- K9 / X9. The claim being tested is not "the policy text mentions
-- published_at" — that is what the vitest suite checks and it is not the same
-- thing. The claim is: signed in AS THE CHILD, asking for the coach's private
-- note by its assessment id returns nothing, and asking for shared feedback
-- returns only what the coach explicitly published.
--
-- Every denial here is paired with a positive control. A suite made entirely of
-- "this returned zero rows" also passes when auth.uid() is NULL and nothing
-- matches anything — it looks strongest exactly when it is testing nothing.
-- Tarek hit that on U7 and it is worth not repeating.
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to run coach-notes fixtures outside the disposable test harness';
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

-- ── Fixtures ────────────────────────────────────────────────────────────
-- Inserted as the owning role, like parent_invite_security.sql: service_role
-- bypasses RLS but holds no grant on auth.users.

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'coachA@k9.test',  now()),
  ('a0000000-0000-0000-0000-000000000002', 'coachB@k9.test',  now()),
  ('b0000000-0000-0000-0000-000000000001', 'child@k9.test',   now());

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'coach',  'Coach A'),
  ('a0000000-0000-0000-0000-000000000002', 'coach',  'Coach B'),
  ('b0000000-0000-0000-0000-000000000001', 'player', 'Child One');

-- Coach A's roster row, linked to the child's own account.
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name, status) VALUES
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'Child One', 'active');

INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id) VALUES
  ('d0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001');

-- The private note. This is the text that must never reach the child.
INSERT INTO public.coach_assessment_notes (assessment_id, coach_user_id, note) VALUES
  ('d0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'Struggles under pressure; do not raise with the family yet.');

-- Shared feedback, written separately, deliberately left UNPUBLISHED.
INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at) VALUES
  ('d0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'Great week. Keep working on your first touch.',
   NULL);

-- ── The child ───────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- POSITIVE CONTROL. If this returns 0 the identity is not working and every
-- denial below would pass for the wrong reason.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments
    WHERE id = 'd0000000-0000-0000-0000-000000000001') = 1,
  'CONTROL: the child can read their own assessment');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessment_notes
    WHERE assessment_id = 'd0000000-0000-0000-0000-000000000001') = 0,
  'K9: the child cannot read the coach private note, asked for by assessment id');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessment_notes) = 0,
  'K9: the child cannot read any coach note at all');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback) = 0,
  'K9: unpublished shared feedback is invisible to the child it is about');

-- ── The coach publishes it ──────────────────────────────────────────────
RESET ROLE;
UPDATE public.coach_shared_feedback
   SET published_at = now()
 WHERE assessment_id = 'd0000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- The same query as above, same actor, different outcome. This is what makes
-- the zero-row results above evidence rather than an absence of data.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback) = 1,
  'K9: published shared feedback IS visible to the child');

SELECT pg_temp.assert_true(
  (SELECT body FROM public.coach_shared_feedback LIMIT 1)
    = 'Great week. Keep working on your first touch.',
  'K9: the child reads the shared text');

-- Publication must not have widened the note itself.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessment_notes) = 0,
  'K9: publishing shared feedback does not expose the private note');

-- ── Coach A owns both ───────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessment_notes) = 1,
  'CONTROL: coach A still reads their own private note');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback) = 1,
  'CONTROL: coach A reads their own shared feedback');

-- ── A coach from another academy ────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessment_notes) = 0,
  'K9: another academy''s coach reads none of coach A''s notes');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback) = 0,
  'K9: another academy''s coach reads none of coach A''s shared feedback');

-- ── K7: academy-scoped assessment reads ─────────────────────────────────
-- Coach A and Coach B are both coaches, but so far in this fixture neither
-- belongs to an organisation, so B must NOT see A's assessment. That is the
-- pre-condition: the new policy must not grant anything on its own.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments) = 0,
  'K7: a coach with no academy sees no other coach''s assessments');

-- Put both coaches in the SAME academy and attribute the roster row to it.
RESET ROLE;
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('e0000000-0000-0000-0000-000000000001', 'admin@k9.test', now());
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  ('f0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001', 'K9 Academy', 'K9ACAD'),
  ('f0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000001', 'Other Academy', 'OTHER1');

INSERT INTO public.coach_details (user_id, organization_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001');

UPDATE public.squad_players
   SET organization_id = 'f0000000-0000-0000-0000-000000000001'
 WHERE id = 'c0000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- The point of K7: a colleague in the same academy now sees the assessment.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments) = 1,
  'K7: a coach reads a colleague''s assessment on a roster row in their own academy');

-- ...and still not the private note that came with it.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessment_notes) = 0,
  'K7: widening assessment reads does not widen the private note');

-- Move coach B to a different academy. Same coach, same query, no access.
RESET ROLE;
UPDATE public.coach_details
   SET organization_id = 'f0000000-0000-0000-0000-000000000002'
 WHERE user_id = 'a0000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments) = 0,
  'K7: a coach in another academy reads none of it');

-- A departed coach has coach_details.organization_id NULL (remove_coach_from_org
-- sets it), which must resolve to no access rather than to "any academy".
RESET ROLE;
UPDATE public.coach_details SET organization_id = NULL
 WHERE user_id = 'a0000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments) = 0,
  'K7/U8: a departed coach reads no academy assessments');

-- An UNATTRIBUTED roster row must not become academy-visible.
--
-- The first version of this tried to null an existing row's organization_id
-- and silently failed: trg_set_squad_player_org pins the value and refuses
-- A -> NULL, so the row kept its academy and the assertion was testing nothing.
-- (That refusal is F6, still open and Imad's.) A row must therefore be created
-- unattributed, which means a coach who has no academy — the stamp trigger
-- takes the org from the coach on INSERT.
RESET ROLE;
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('a0000000-0000-0000-0000-000000000003', 'coachC@k9.test', now());
INSERT INTO public.profiles (user_id, role, full_name)
VALUES ('a0000000-0000-0000-0000-000000000003', 'coach', 'Coach C');
-- Deliberately no coach_details row: Coach C belongs to no academy.
INSERT INTO public.squad_players (id, coach_user_id, player_name, status)
VALUES ('c0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000003', 'Child Two', 'active');
INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id)
VALUES ('d0000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000003');

SELECT pg_temp.assert_true(
  (SELECT organization_id IS NULL FROM public.squad_players
    WHERE id = 'c0000000-0000-0000-0000-000000000002'),
  'PREMISE: the second roster row really is unattributed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- Coach B is in academy 1 and must still see only academy 1's row, not the
-- unattributed one.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments
    WHERE squad_player_id = 'c0000000-0000-0000-0000-000000000002') = 0,
  'K7: an unattributed roster row is not visible to the academy, only to its own coach');

-- CONTROL: its own coach still reads it, so the zero above is scoping rather
-- than the row being unreadable by everyone.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments
    WHERE squad_player_id = 'c0000000-0000-0000-0000-000000000002') = 1,
  'CONTROL: the unattributed row IS readable by the coach who owns it');

-- CONTROL: the owning coach still reads their own throughout.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments) = 1,
  'CONTROL: the assessing coach still reads their own assessment');

-- ── Table privileges, which RLS does not govern ─────────────────────────
-- Tarek found this on #44: the migration revoked from PUBLIC and anon but not
-- from `authenticated`, so the table kept the schema's default grants. RLS
-- covers SELECT/INSERT/UPDATE/DELETE and does NOT cover TRUNCATE — so a
-- signed-in player could empty every child's published feedback in the
-- academy, with no error and no policy able to stop it.
--
-- Asserted as a privilege check rather than a policy one, because no policy
-- could ever have caught it.
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.coach_shared_feedback', 'TRUNCATE'),
  'K9: authenticated must not hold TRUNCATE on coach_shared_feedback — TRUNCATE ignores RLS');

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.coach_shared_feedback', 'TRUNCATE'),
  'K9: anon must not hold TRUNCATE on coach_shared_feedback');

SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.coach_shared_feedback', 'DELETE'),
  'K9: authenticated must not hold DELETE on coach_shared_feedback — the no-deletion policy '
  'should not be the only thing standing between a child and a removed record');

-- The grants the table actually needs must survive the revoke.
SELECT pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.coach_shared_feedback', 'SELECT')
  AND has_table_privilege('authenticated', 'public.coach_shared_feedback', 'INSERT')
  AND has_table_privilege('authenticated', 'public.coach_shared_feedback', 'UPDATE'),
  'CONTROL: authenticated keeps the SELECT/INSERT/UPDATE the application needs');

ROLLBACK;

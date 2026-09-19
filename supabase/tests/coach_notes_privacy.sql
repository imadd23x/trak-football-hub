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


-- ── K9, final piece: a parent reads their child's published feedback ────
--
-- Imad decided yes; Kostas confirmed it as a human decision, because it defines
-- what a parent can see about their child. Migration 20260919150000.
--
-- The claim worth testing is not "a parent can see something" — a policy of
-- USING (true) passes that. It is that a parent sees their OWN child's
-- PUBLISHED feedback and nothing else. So the fixture adds a SECOND child under
-- the SAME coach with their own published row: without a second child, "only
-- their own" is not falsifiable.

RESET ROLE;
-- RESET ROLE does not clear request.jwt.claims, and the K1 trigger on
-- squad_players.linked_player_id refuses a link made by anyone other than that
-- player. Left set, the claims from the K7 section above are still in effect
-- and the roster insert below is rejected as coach B linking someone else's
-- child — which is the trigger working correctly.
SELECT set_config('request.jwt.claims', NULL, true);

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'child2@k9.test',  now()),
  ('b0000000-0000-0000-0000-000000000009', 'parent@k9.test',  now());

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'player', 'Child Two'),
  ('b0000000-0000-0000-0000-000000000009', 'parent', 'Parent One');

-- Child Two is on the SAME coach's roster as Child One.
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name, status, organization_id) VALUES
  ('c0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002',
   'Child Two', 'active', 'f0000000-0000-0000-0000-000000000001');

INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id) VALUES
  ('d0000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001');

-- Child Two's feedback is PUBLISHED. The canary belongs to the other family.
INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at) VALUES
  ('d0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001',
   'CHILD-TWO-FEEDBACK-CANARY',
   now());

-- The parent is linked to Child One only.
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000009');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);

-- POSITIVE CONTROL first. Child One's row was published earlier in this suite,
-- so if this returns 0 every denial below would pass for the wrong reason.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback
    WHERE assessment_id = 'd0000000-0000-0000-0000-000000000001') = 1,
  'K9: a parent reads their own child''s PUBLISHED feedback');

-- THE assertion. Same coach, same academy, different family.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback
    WHERE body = 'CHILD-TWO-FEEDBACK-CANARY') = 0,
  'K9: a parent does NOT read another child''s feedback, even under the same coach');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback) = 1,
  'K9: exactly one row is visible to the parent — their child''s, and no other');

-- The parent sees what the CHILD sees. A private note is neither.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessment_notes) = 0,
  'K9: a parent reads no coach private note — parent access does not reopen K9');

-- ── A dependency this suite could not otherwise see ─────────────────────
--
-- Found by mutation, and it survived: replacing the parent policy's join
-- condition with ON true — so that ANY parent link belonging to the caller
-- satisfies it — does NOT make another child's feedback visible, and every
-- assertion above still passes.
--
-- The reason is that RLS applies to coach_assessments INSIDE the parent
-- policy's EXISTS. 20260612000001 already scopes a parent's view of that table
-- to their own linked children, so the subquery cannot reach another child's
-- assessment however the join is written. The explicit join condition in
-- 20260919150000 is therefore defence in depth rather than the thing doing the
-- work — and it is kept for exactly that reason.
--
-- The consequence worth pinning: if a future migration widens a parent's read
-- of coach_assessments, the feedback policy widens with it, silently. So the
-- upstream invariant is asserted HERE, where it will fail next to the policy
-- that depends on it, rather than being discovered by a parent reading another
-- family's feedback.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_assessments) = 1,
  'K9 DEPENDENCY: a parent reads only their own child''s assessment. '
  'The parent feedback policy leans on this scoping — widening it widens that.');

-- Unpublished means unpublished for the parent too. Retract Child One's row and
-- the parent loses it, exactly as the child does.
RESET ROLE;
UPDATE public.coach_shared_feedback
   SET published_at = NULL
 WHERE assessment_id = 'd0000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback) = 0,
  'K9: retraction removes the row from the parent as well as the child');

-- Put it back, so the last state of the fixture matches the decided behaviour.
RESET ROLE;
UPDATE public.coach_shared_feedback
   SET published_at = now()
 WHERE assessment_id = 'd0000000-0000-0000-0000-000000000001';

-- An unrelated parent is linked to nobody here and must read nothing. Without
-- this, a policy keyed on "is a parent at all" would pass everything above.
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('b0000000-0000-0000-0000-00000000000a', 'otherparent@k9.test', now());
INSERT INTO public.profiles (user_id, role, full_name)
VALUES ('b0000000-0000-0000-0000-00000000000a', 'parent', 'Unrelated Parent');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.coach_shared_feedback) = 0,
  'K9: a parent with no link to any child reads nothing');

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);

ROLLBACK;

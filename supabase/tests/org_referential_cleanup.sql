-- @trak-suite mode=--org-cleanup-review in-all=true
-- Execute against a DISPOSABLE database after replaying migrations.
-- The harness must SET trak.test_database = 'disposable' on this connection.
-- All fixtures are rolled back.
--
-- F6. The claim being tested is not "the trigger source mentions NOT EXISTS".
-- It is: a club admin calls delete_my_account() and the account is gone, while
-- the three transitions the pin exists to refuse are still refused.
--
-- Every denial is paired with a positive control, and the deletion assertion
-- is verified PRIVILEGED rather than as the deleted user. Someone who has just
-- deleted their account has no session, so reading back as them returns
-- nothing whether it worked or not — Tarek lost four findings to that in the
-- isolation suite and the same trap is here.
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to run org-cleanup fixtures outside the disposable test harness';
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

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'admin@f6.test',   now()),
  ('e0000000-0000-0000-0000-000000000002', 'adminB@f6.test',  now()),
  ('e0000000-0000-0000-0000-000000000003', 'coach@f6.test',   now()),
  ('e0000000-0000-0000-0000-000000000004', 'orphan@f6.test',  now());

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'club',  'Academy Admin'),
  ('e0000000-0000-0000-0000-000000000002', 'club',  'Other Admin'),
  ('e0000000-0000-0000-0000-000000000003', 'coach', 'Academy Coach'),
  ('e0000000-0000-0000-0000-000000000004', 'coach', 'Unattached Coach');

INSERT INTO public.organizations (id, name, join_code, admin_user_id) VALUES
  ('f0000000-0000-0000-0000-00000000000a', 'Academy A', 'AAAA', 'e0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-00000000000b', 'Academy B', 'BBBB', 'e0000000-0000-0000-0000-000000000002');

INSERT INTO public.coach_details (user_id, organization_id) VALUES
  ('e0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000004', NULL);

-- Roster row and assessment under Academy A. The insert-time triggers stamp
-- organization_id from the coach, so these carry Academy A.
INSERT INTO public.squad_players (id, coach_user_id, player_name, status) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003', 'Child A', 'active');

INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id) VALUES
  ('d1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000003');

-- POSITIVE CONTROL for the fixtures themselves. If these are already NULL the
-- cleanup assertions below would pass without anything having been cleaned up.
SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.squad_players
    WHERE id = 'c1000000-0000-0000-0000-000000000001') = 'f0000000-0000-0000-0000-00000000000a',
  'fixture: the roster row was stamped with Academy A');

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.coach_assessments
    WHERE id = 'd1000000-0000-0000-0000-000000000001') = 'f0000000-0000-0000-0000-00000000000a',
  'fixture: the assessment was stamped with Academy A');


-- ── 1. The pin still refuses what it exists to refuse ───────────────────
--
-- Run first, while Academy A still exists. These are the cases that must NOT
-- be loosened by the F6 carve-out, and asserting them after the deletion would
-- prove nothing.

UPDATE public.coach_assessments
  SET organization_id = 'f0000000-0000-0000-0000-00000000000b'
  WHERE id = 'd1000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.coach_assessments
    WHERE id = 'd1000000-0000-0000-0000-000000000001') = 'f0000000-0000-0000-0000-00000000000a',
  'an assessment cannot be moved from one academy to another');

UPDATE public.coach_assessments
  SET organization_id = NULL
  WHERE id = 'd1000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.coach_assessments
    WHERE id = 'd1000000-0000-0000-0000-000000000001') = 'f0000000-0000-0000-0000-00000000000a',
  'an assessment cannot be detached from an academy that still exists');

UPDATE public.squad_players
  SET organization_id = NULL
  WHERE id = 'c1000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.squad_players
    WHERE id = 'c1000000-0000-0000-0000-000000000001') = 'f0000000-0000-0000-0000-00000000000a',
  'a roster row cannot be detached from an academy that still exists');


-- ── 2. First attribution: NULL -> an academy ────────────────────────────
--
-- An assessment written before the coach joined an academy. Under the old
-- unconditional pin this stayed NULL permanently, invisible to the academy
-- dashboard however long the coach later belonged to it.

INSERT INTO public.squad_players (id, coach_user_id, player_name, status) VALUES
  ('c1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000004', 'Child B', 'active');

INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id) VALUES
  ('d1000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000004');

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.coach_assessments
    WHERE id = 'd1000000-0000-0000-0000-000000000002') IS NULL,
  'fixture: an unattached coach''s assessment carries no academy');

-- The coach joins Academy B.
UPDATE public.coach_details
  SET organization_id = 'f0000000-0000-0000-0000-00000000000b'
  WHERE user_id = 'e0000000-0000-0000-0000-000000000004';

UPDATE public.coach_assessments
  SET appearance = 'training'
  WHERE id = 'd1000000-0000-0000-0000-000000000002';

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.coach_assessments
    WHERE id = 'd1000000-0000-0000-0000-000000000002') = 'f0000000-0000-0000-0000-00000000000b',
  'an unattributed assessment is adopted once its coach joins an academy');


-- ── 3. F6: the club admin can actually delete their account ─────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Before the carve-out this raised 23503: the FK's ON DELETE SET NULL issued
-- an UPDATE, the trigger put the deleted organisation's id back, and the
-- constraint failed against a row that no longer existed.
SELECT public.delete_my_account();

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);

-- Verified privileged, not as the deleted user.
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'e0000000-0000-0000-0000-000000000001'),
  'the club admin account is gone');

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 'f0000000-0000-0000-0000-00000000000a'),
  'the deleted admin''s academy is gone');

-- The referential cleanup reached the child's records rather than raising.
SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.squad_players
    WHERE id = 'c1000000-0000-0000-0000-000000000001') IS NULL,
  'the roster row no longer references the deleted academy');

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.coach_assessments
    WHERE id = 'd1000000-0000-0000-0000-000000000001') IS NULL,
  'the assessment no longer references the deleted academy');

-- The child's record itself survives. Erasing an academy must not erase the
-- assessment history of the children it coached — that is the whole reason
-- 20260608000002 snapshots the coach's name rather than cascading.
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.coach_assessments
           WHERE id = 'd1000000-0000-0000-0000-000000000001'),
  'the assessment itself survives the academy deletion');

SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.squad_players
           WHERE id = 'c1000000-0000-0000-0000-000000000001'),
  'the roster row itself survives the academy deletion');

-- The other academy is untouched. A deletion that took a second academy's
-- rows with it would pass every "is it gone?" assertion above.
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM public.organizations WHERE id = 'f0000000-0000-0000-0000-00000000000b'),
  'the other academy is untouched');

SELECT pg_temp.assert_true(
  (SELECT organization_id FROM public.coach_assessments
    WHERE id = 'd1000000-0000-0000-0000-000000000002') = 'f0000000-0000-0000-0000-00000000000b',
  'the other academy''s assessment still carries its academy');

ROLLBACK;

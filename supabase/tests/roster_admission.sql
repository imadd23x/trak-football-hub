-- @trak-suite mode=--roster-admission-review in-all=true
-- TRAK-49 [J1]: the academy roster tables.
-- Execute against a DISPOSABLE database after replaying migrations.
-- The harness must SET trak.test_database = 'disposable' on this connection.
-- Real roles, no mocks. Everything is rolled back.
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to run roster-admission fixtures outside the disposable test harness';
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

-- Runs the statement and reports the SQLSTATE it raised, or 'allowed'.
CREATE FUNCTION pg_temp.outcome(statement text)
RETURNS text LANGUAGE plpgsql AS $test$
BEGIN
  EXECUTE statement;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$test$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.outcome(text) TO anon, authenticated;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a9000000-0000-0000-0000-000000000001', 'admin-a@roster.test', now()),
  ('a9000000-0000-0000-0000-000000000002', 'admin-b@roster.test', now()),
  ('a9000000-0000-0000-0000-000000000003', 'coach-a@roster.test', now()),
  ('a9000000-0000-0000-0000-000000000004', 'child-a@roster.test', now()),
  ('a9000000-0000-0000-0000-000000000005', 'guardian-a@roster.test', now()),
  ('a9000000-0000-0000-0000-000000000006', 'coach-b@roster.test', now()),
  ('a9000000-0000-0000-0000-000000000007', 'unrostered-child@roster.test', now());

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('a9000000-0000-0000-0000-000000000003', 'coach', 'Roster Coach'),
  ('a9000000-0000-0000-0000-000000000004', 'player', 'Roster Child'),
  ('a9000000-0000-0000-0000-000000000005', 'parent', 'Roster Guardian'),
  ('a9000000-0000-0000-0000-000000000006', 'coach', 'Other Academy Coach'),
  ('a9000000-0000-0000-0000-000000000001', 'club', 'Roster Academy Admin'),
  ('a9000000-0000-0000-0000-000000000002', 'club', 'Unrostered Academy Admin'),
  ('a9000000-0000-0000-0000-000000000007', 'player', 'Unrostered Control');

INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  ('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'Roster Academy A', 'ROSTER-A'),
  ('a9100000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002', 'Roster Academy B', 'ROSTER-B');

-- A squad row takes its academy from its coach (20260920152925).
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  ('a9000000-0000-0000-0000-000000000003', 'a9100000-0000-0000-0000-000000000001'),
  ('a9000000-0000-0000-0000-000000000006', 'a9100000-0000-0000-0000-000000000002');

INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group, linked_player_id) VALUES
  ('a9200000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003', 'Sibling One', 'U15', 'a9000000-0000-0000-0000-000000000004'),
  ('a9200000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000003', 'Sibling Two', 'U13', NULL),
  ('a9200000-0000-0000-0000-000000000003', 'a9000000-0000-0000-0000-000000000006', 'Other Academy', 'U15', NULL),
  ('a9200000-0000-0000-0000-000000000004', 'a9000000-0000-0000-0000-000000000003', 'Unrostered Control', 'U15', 'a9000000-0000-0000-0000-000000000007'),
  ('a9200000-0000-0000-0000-000000000005', 'a9000000-0000-0000-0000-000000000003', 'Coach Removable', 'U15', NULL);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 5 FROM public.squad_players sp
   JOIN public.coach_details cd ON cd.user_id = sp.coach_user_id
   WHERE sp.id::text LIKE 'a92%' AND sp.organization_id = cd.organization_id),
  'fixture: each squad row sits in its coach''s academy');

-- ── Positive controls: the operator load works ──────────────
SET LOCAL ROLE service_role;
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, player_user_id, loaded_by, source_file) VALUES
  ('a9300000-0000-0000-0000-000000000001', 'a9100000-0000-0000-0000-000000000001', 'a9200000-0000-0000-0000-000000000001', '2011-03-04', 'child-a@roster.test', 'a9000000-0000-0000-0000-000000000004', 'kostas', 'roster-a.csv'),
  ('a9300000-0000-0000-0000-000000000002', 'a9100000-0000-0000-0000-000000000001', 'a9200000-0000-0000-0000-000000000002', '2013-07-08', 'child-b@roster.test', NULL, 'kostas', 'roster-a.csv');
INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by) VALUES
  ('a9300000-0000-0000-0000-000000000001', 'guardian-a@roster.test', 'kostas'),
  ('a9300000-0000-0000-0000-000000000001', 'second-guardian@roster.test', 'kostas'),
  -- J2: one guardian covers siblings.
  ('a9300000-0000-0000-0000-000000000002', 'guardian-a@roster.test', 'kostas');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.roster_children), 'the operator loads two children');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.roster_guardians), 'the operator loads three guardian rows, one guardian shared by siblings');

-- ── The load refuses malformed and conflicting rows ─────────
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by)
  VALUES ('a9100000-0000-0000-0000-000000000002', 'a9200000-0000-0000-0000-000000000003', '2011-01-01', 'Child-A@Roster.test', 'kostas')
$$) = '23514', 'an un-normalized email is refused rather than silently stored');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by)
  VALUES ('a9100000-0000-0000-0000-000000000002', 'a9200000-0000-0000-0000-000000000003', '2011-01-01', 'not-an-email', 'kostas')
$$) = '23514', 'a malformed child email is refused');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by)
  VALUES ('a9100000-0000-0000-0000-000000000002', 'a9200000-0000-0000-0000-000000000003', '2011-01-01', 'child-a@roster.test', 'kostas')
$$) = '23505', 'the same child email cannot be admitted twice, even in another academy');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by)
  VALUES ('a9100000-0000-0000-0000-000000000001', 'a9200000-0000-0000-0000-000000000003', '2011-01-01', 'child-c@roster.test', 'kostas')
$$) = '23514', 'a child cannot be admitted to one academy and seated in another academy''s squad');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by)
  VALUES ('a9100000-0000-0000-0000-000000000002', 'a9200000-0000-0000-0000-000000000003', '2011-01-01', 'guardian-a@roster.test', 'kostas')
$$) = '23514', 'a guardian''s email cannot be admitted as a child''s');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by)
  VALUES ('a9100000-0000-0000-0000-000000000002', 'a9200000-0000-0000-0000-000000000003', '2011-01-01', 'child-d@roster.test', '  ')
$$) = '23514', 'a load must name who loaded it');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by)
  VALUES ('a9300000-0000-0000-0000-000000000001', 'child-b@roster.test', 'kostas')
$$) = '23514', 'a child''s email cannot be loaded as a guardian''s (G2/G5)');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by)
  VALUES ('a9300000-0000-0000-0000-000000000001', 'guardian-a@roster.test', 'kostas')
$$) = '23505', 'the same guardian cannot be loaded twice for one child');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.roster_guardians (roster_child_id, email, relationship, loaded_by)
  VALUES ('a9300000-0000-0000-0000-000000000002', 'uncle@roster.test', 'uncle', 'kostas')
$$) = '23514', 'relationship is parent or legal guardian only');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  UPDATE public.roster_guardians SET email = 'child-a@roster.test' WHERE email = 'second-guardian@roster.test'
$$) = '23514', 'an update cannot turn a guardian address into a child''s');
RESET ROLE;

-- ── No app role can read or write the roster (G2, G3, G5) ───
-- Every one of these would let a child, parent or coach see or choose an
-- address or a date of birth. The admission functions are the only readers.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000004","email":"child-a@roster.test","role":"authenticated"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$SELECT 1 FROM public.roster_children$$) = '42501', 'the rostered child cannot read the roster');
SELECT pg_temp.assert_true(pg_temp.outcome($$SELECT 1 FROM public.roster_guardians$$) = '42501', 'the rostered child cannot read guardian addresses');
SELECT pg_temp.assert_true(pg_temp.outcome($$UPDATE public.roster_children SET date_of_birth = '2000-01-01'$$) = '42501', 'the child cannot change their roster date of birth');
SELECT pg_temp.assert_true(pg_temp.outcome($$INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by) VALUES ('a9300000-0000-0000-0000-000000000001', 'friend@roster.test', 'child')$$) = '42501', 'the child cannot add a guardian address');
SELECT pg_temp.assert_true(pg_temp.outcome($$DELETE FROM public.roster_guardians$$) = '42501', 'the child cannot remove a guardian address');

SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000005","email":"guardian-a@roster.test","role":"authenticated"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$SELECT 1 FROM public.roster_guardians$$) = '42501', 'a guardian cannot read the roster');

SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000003","email":"coach-a@roster.test","role":"authenticated"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$SELECT 1 FROM public.roster_children$$) = '42501', 'the child''s coach cannot read child emails or dates of birth');
SELECT pg_temp.assert_true(pg_temp.outcome($$INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES ('a9100000-0000-0000-0000-000000000002', 'a9200000-0000-0000-0000-000000000003', '2011-01-01', 'coach-added@roster.test', 'coach')$$) = '42501', 'a coach cannot admit a child');

SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","email":"admin-a@roster.test","role":"authenticated"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$SELECT 1 FROM public.roster_children$$) = '42501', 'an academy admin cannot read the roster directly (the console is coming soon)');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$SELECT 1 FROM public.roster_children$$) = '42501', 'anonymous requests cannot read the roster');
SELECT pg_temp.assert_true(pg_temp.outcome($$SELECT 1 FROM public.roster_guardians$$) = '42501', 'anonymous requests cannot read guardian addresses');
RESET ROLE;

-- ── admit_roster_child: the operator's one-child load ───────
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(
  (SELECT public.admit_roster_child(
     'a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003',
     '  Loaded Child ', 'U15', '2011-05-06', ' Loaded-Child@Roster.TEST ',
     ARRAY['Guardian-A@roster.test', 'guardian-a@roster.test ', 'new-guardian@roster.test', ''],
     'kostas', 'roster-a.csv') IS NOT NULL),
  'the operator admits a child in one call');
SELECT pg_temp.assert_true(
  (SELECT sp.organization_id = 'a9100000-0000-0000-0000-000000000001' AND sp.player_name = 'Loaded Child'
          AND rc.child_email = 'loaded-child@roster.test' AND rc.date_of_birth = '2011-05-06'
   FROM public.roster_children rc JOIN public.squad_players sp ON sp.id = rc.squad_player_id
   WHERE rc.child_email = 'loaded-child@roster.test'),
  'the load creates the squad row in the coach''s academy and a normalized roster row');
SELECT pg_temp.assert_true(
  (SELECT array_agg(g.email ORDER BY g.email) = ARRAY['guardian-a@roster.test', 'new-guardian@roster.test']
   FROM public.roster_guardians g JOIN public.roster_children rc ON rc.id = g.roster_child_id
   WHERE rc.child_email = 'loaded-child@roster.test'),
  'guardian emails are normalized, de-duplicated and blanks dropped');

CREATE TEMP TABLE squad_count_before AS SELECT count(*) AS n FROM public.squad_players;
SELECT pg_temp.assert_true(pg_temp.outcome($$
  SELECT public.admit_roster_child('a9100000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000003',
    'Wrong Academy', 'U15', '2011-01-01', 'wrong-academy@roster.test', ARRAY['g1@roster.test'], 'kostas')
$$) = '23514', 'a coach from another academy is refused');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  SELECT public.admit_roster_child('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003',
    'No Guardian', 'U15', '2011-01-01', 'no-guardian@roster.test', ARRAY[' ', ''], 'kostas')
$$) = '22023', 'a child with no guardian email is refused');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  SELECT public.admit_roster_child('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003',
    'Self Guardian', 'U15', '2011-01-01', 'self@roster.test', ARRAY['SELF@roster.test'], 'kostas')
$$) = '23514', 'a child named as their own guardian is refused');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  SELECT public.admit_roster_child('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003',
    'No Birthday', 'U15', NULL, 'no-dob@roster.test', ARRAY['g2@roster.test'], 'kostas')
$$) = '22023', 'a child with no date of birth is refused');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  SELECT public.admit_roster_child('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003',
    'Duplicate', 'U15', '2011-01-01', 'child-a@roster.test', ARRAY['g3@roster.test'], 'kostas')
$$) = '23505', 'an already admitted child email is refused');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.squad_players) = (SELECT n FROM squad_count_before),
  'a refused load leaves no squad row behind');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000003","email":"coach-a@roster.test","role":"authenticated"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$
  SELECT public.admit_roster_child('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003',
    'Coach Added', 'U15', '2011-01-01', 'coach-added-2@roster.test', ARRAY['g4@roster.test'], 'coach')
$$) = '42501', 'a coach cannot call the operator load');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$
  SELECT public.admit_roster_child('a9100000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003',
    'Anon Added', 'U15', '2011-01-01', 'anon-added@roster.test', ARRAY['g5@roster.test'], 'anon')
$$) = '42501', 'an anonymous request cannot call the operator load');
RESET ROLE;

-- ── The trigger functions are not RPCs ──────────────────────
SELECT pg_temp.assert_true(
  NOT has_function_privilege('authenticated', 'public.roster_email_roles_disjoint()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.roster_email_roles_disjoint()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.roster_child_matches_squad_academy()', 'EXECUTE'),
  'the roster trigger functions cannot be called by app roles');

-- ── A coach cannot un-admit a child (J1, TRAK-62) ───────────
-- roster_children cascades from squad_players, so a coach's DELETE of a
-- rostered squad row would otherwise delete the academy's admission.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000003","email":"coach-a@roster.test","role":"authenticated"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$
  DELETE FROM public.squad_players WHERE id = 'a9200000-0000-0000-0000-000000000002'
$$) = '42501', 'a coach cannot delete a rostered child''s squad row');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.squad_players WHERE id = 'a9200000-0000-0000-0000-000000000002'),
  'the refused squad row is still there');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  DELETE FROM public.squad_players WHERE id = 'a9200000-0000-0000-0000-000000000005'
$$) = 'allowed', 'CONTROL a coach can still delete their own unrostered squad row');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.squad_players WHERE id = 'a9200000-0000-0000-0000-000000000005'),
  'CONTROL the unrostered squad row is gone');
RESET ROLE;
-- A trusted function called while the coach is signed in is refused too.
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$
  DELETE FROM public.squad_players WHERE id = 'a9200000-0000-0000-0000-000000000002'
$$) = '42501', 'a privileged delete on the coach''s behalf cannot un-admit a child either');
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.assert_true(
  NOT has_function_privilege('authenticated', 'public.refuse_app_delete_of_rostered_squad_row()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.refuse_app_delete_of_rostered_squad_row()', 'EXECUTE'),
  'the trigger function is not an RPC');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.roster_children WHERE id = 'a9300000-0000-0000-0000-000000000002'),
  'the refused coach delete left the admission in place');

-- Tarek's #128 re-review: a coach may relink their own squad row to
-- themselves (the self-link rule allows linking to the caller). That must not
-- turn into authority to erase the admission. Only the admission's own
-- player_user_id, which no app role can write, counts as the child.
SAVEPOINT coach_self_link;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
UPDATE public.squad_players SET linked_player_id = auth.uid()
  WHERE id = 'a9200000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_true(pg_temp.outcome($$
  DELETE FROM public.squad_players WHERE id = 'a9200000-0000-0000-0000-000000000002'
$$) = '42501', 'a coach who links a rostered row to themselves still cannot delete it');
RESET ROLE;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM public.roster_children WHERE id = 'a9300000-0000-0000-0000-000000000002')
  AND EXISTS (SELECT 1 FROM public.roster_guardians WHERE roster_child_id = 'a9300000-0000-0000-0000-000000000002'),
  'the relinked admission and its guardians survive');
ROLLBACK TO SAVEPOINT coach_self_link;
SELECT set_config('request.jwt.claims', '', true);

-- ── Account deletion through the real RPC (Tarek's #128 review) ─
-- Each call runs delete_my_account() as the signed-in user, checks the
-- outcome, then rolls itself back so the next call sees the same fixtures.
-- A direct DELETE FROM auth.users would skip the RPC's earlier squad and
-- academy steps, which is where the foreign keys bite.
CREATE TEMP TABLE roster_deletion_review(description text, passed boolean, detail text);
GRANT INSERT ON roster_deletion_review TO authenticated;
CREATE FUNCTION pg_temp.roster_user_exists(p_uid uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $test$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_uid);
$test$;
CREATE FUNCTION pg_temp.roster_rows(p_org uuid) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $test$
  SELECT count(*) FROM public.roster_children WHERE organization_id = p_org;
$test$;
CREATE FUNCTION pg_temp.roster_row_exists(p_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $test$
  SELECT EXISTS (SELECT 1 FROM public.roster_children WHERE id = p_id);
$test$;
REVOKE ALL ON FUNCTION pg_temp.roster_user_exists(uuid), pg_temp.roster_rows(uuid), pg_temp.roster_row_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.roster_user_exists(uuid), pg_temp.roster_rows(uuid), pg_temp.roster_row_exists(uuid) TO authenticated;
CREATE FUNCTION pg_temp.review_account_deletion(description text, expect_after text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; expected boolean; failure text; constraint_name text;
BEGIN
  BEGIN
    PERFORM public.delete_my_account();
    EXECUTE 'SELECT (' || expect_after || ')' INTO expected;
    ok := NOT pg_temp.roster_user_exists(auth.uid()) AND expected IS TRUE;
    IF NOT ok THEN failure := 'account still exists, or roster not as expected: ' || expect_after; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P9222', MESSAGE = 'rollback deletion probe';
  EXCEPTION
    WHEN SQLSTATE 'P9222' THEN NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      failure := SQLSTATE || ': ' || SQLERRM || ' constraint=' || coalesce(constraint_name, '');
  END;
  INSERT INTO pg_temp.roster_deletion_review VALUES (description, ok, failure);
END;
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.review_account_deletion(text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000007","role":"authenticated","email":"unrostered-child@roster.test"}', true);
SELECT pg_temp.review_account_deletion('CONTROL a child without a roster admission deletes their account',
  $$pg_temp.roster_rows('a9100000-0000-0000-0000-000000000001') = 3$$);
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000004","role":"authenticated","email":"child-a@roster.test"}', true);
SELECT pg_temp.review_account_deletion('a rostered child deletes their account, and erasure removes their admission',
  $$NOT pg_temp.roster_row_exists('a9300000-0000-0000-0000-000000000001') AND pg_temp.roster_rows('a9100000-0000-0000-0000-000000000001') = 2$$);
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000002","role":"authenticated","email":"admin-b@roster.test"}', true);
SELECT pg_temp.review_account_deletion('CONTROL an admin without roster admissions deletes their account',
  $$pg_temp.roster_rows('a9100000-0000-0000-0000-000000000001') = 3$$);
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated","email":"admin-a@roster.test"}', true);
SELECT pg_temp.review_account_deletion('an admin with roster admissions deletes their account, and the academy''s roster goes with it',
  $$pg_temp.roster_rows('a9100000-0000-0000-0000-000000000001') = 0$$);
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000003","role":"authenticated","email":"coach-a@roster.test"}', true);
SELECT pg_temp.review_account_deletion('CONTROL a rostered child''s coach deletes their account and the roster stays',
  $$pg_temp.roster_rows('a9100000-0000-0000-0000-000000000001') = 3$$);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.roster_deletion_review;
  IF total <> 5 OR failed <> 0 THEN
    RAISE EXCEPTION 'Roster account deletion: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.roster_deletion_review WHERE NOT passed);
  END IF;
END;
$test$;

-- ── The operator can still remove a child from the roster ───
-- Give the row a linked account first, so this exercises the operator's
-- exemption (no signed-in user), not the child's own-erasure one.
UPDATE public.squad_players SET linked_player_id = 'a9000000-0000-0000-0000-000000000007'
WHERE id = 'a9200000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.assert_true(pg_temp.outcome($$
  DELETE FROM public.squad_players WHERE id = 'a9200000-0000-0000-0000-000000000002'
$$) = 'allowed', 'the operator (service_role) can remove a rostered child');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.roster_children WHERE id = 'a9300000-0000-0000-0000-000000000002')
  AND (SELECT count(*) = 1 FROM public.roster_guardians g JOIN public.roster_children rc ON rc.id = g.roster_child_id
       WHERE g.email = 'guardian-a@roster.test' AND rc.id = 'a9300000-0000-0000-0000-000000000001'),
  'removing the squad row removes that admission and its guardian rows, and leaves the sibling''s');
RESET ROLE;

-- ── Deleting a child's auth user directly keeps the admission, unclaimed ─
-- The operator's path (dashboard or admin API), not the child's own erasure
-- above: the squad row survives, so the admission does too, ready to reclaim.
DELETE FROM auth.users WHERE id = 'a9000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert_true(
  (SELECT player_user_id IS NULL FROM public.roster_children WHERE id = 'a9300000-0000-0000-0000-000000000001'),
  'deleting the child''s account unclaims the roster entry instead of failing or deleting it');

ROLLBACK;

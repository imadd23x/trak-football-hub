-- @trak-suite mode=--approved-awaiting-review in-all=true
-- TRAK-98 (G6): a guardian who approved a rostered child before that child has
-- an account must see the child and be able to withdraw. The parent's child
-- list is player_parent_links, which only exists after the child signs up, so
-- get_my_approved_children_awaiting_signup() lists the guardian's own live
-- roster consents for a child with no account yet. Withdrawal is the existing
-- withdraw_roster_consent(); this suite checks the two work together.
-- Synthetic fixtures only; run after real migrations in a disposable database.
-- The whole suite is one transaction and rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing approved-children fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.aa(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98d00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE aa_results (description text, passed boolean, detail text);
GRANT INSERT ON aa_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.aa_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text END, true);
END;
$test$;

CREATE FUNCTION pg_temp.aa_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.aa_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.aa_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.aa_results VALUES (description, coalesce(ok, false), detail);
$test$;

CREATE FUNCTION pg_temp.aa_consent(p_roster_child uuid) RETURNS text LANGUAGE sql AS $test$
  SELECT format($$SELECT public.record_roster_consent(%L, 'parent',
    '{"coaching_records":true,"recognition":false,"parent_visibility":true}'::jsonb,
    '2026-09-12.1', 'Synthetic roster consent.')$$, p_roster_child);
$test$;
CREATE FUNCTION pg_temp.aa_signup(p_role text, p_name text) RETURNS text LANGUAGE sql AS $test$
  SELECT CASE p_role
    WHEN 'parent' THEN format($$SELECT public.provision_my_profile(jsonb_build_object('role', 'parent', 'full_name', %L))$$, p_name)
    ELSE format($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', %L,
      'player_details', jsonb_build_object('date_of_birth', '2013-01-01', 'position', 'Defender')))$$, p_name)
  END;
$test$;
-- The caller's list, as "child-id:first-name" in name order.
CREATE FUNCTION pg_temp.aa_list() RETURNS text LANGUAGE sql AS $test$
  SELECT coalesce(string_agg(right(roster_child_id::text, 2) || ':' || first_name, ' ' ORDER BY first_name, roster_child_id), '')
  FROM public.get_my_approved_children_awaiting_signup();
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Guardian A (20) of siblings 70 Sam and 71 Tia; guardian B (21) of 72 Uma and
-- a second guardian of Tia. Tia's guardians each consent separately.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.aa(1),  'admin@approved-awaiting.test',      now()),
  (pg_temp.aa(2),  'coach@approved-awaiting.test',      now()),
  (pg_temp.aa(10), 'sam@approved-awaiting.test',        now()),
  (pg_temp.aa(20), 'guardian-a@approved-awaiting.test', now()),
  (pg_temp.aa(21), 'guardian-b@approved-awaiting.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.aa(1), 'club',  'AA Admin'),
  (pg_temp.aa(2), 'coach', 'AA Coach');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.aa(50), pg_temp.aa(1), 'AA Academy', 'AA-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.aa(2), pg_temp.aa(50));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.aa(60), pg_temp.aa(2), 'Sam Synthetic', 'U14'),
  (pg_temp.aa(61), pg_temp.aa(2), 'Tia Synthetic', 'U16'),
  (pg_temp.aa(62), pg_temp.aa(2), 'Uma Synthetic', 'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.aa(70), pg_temp.aa(50), pg_temp.aa(60), '2013-03-04', 'sam@approved-awaiting.test', 'fixture'),
  (pg_temp.aa(71), pg_temp.aa(50), pg_temp.aa(61), '2011-05-06', 'tia@approved-awaiting.test', 'fixture'),
  (pg_temp.aa(72), pg_temp.aa(50), pg_temp.aa(62), '2013-07-08', 'uma@approved-awaiting.test', 'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by) VALUES
  (pg_temp.aa(70), 'guardian-a@approved-awaiting.test', 'fixture'),
  (pg_temp.aa(71), 'guardian-a@approved-awaiting.test', 'fixture'),
  (pg_temp.aa(71), 'guardian-b@approved-awaiting.test', 'fixture'),
  (pg_temp.aa(72), 'guardian-b@approved-awaiting.test', 'fixture');

SET LOCAL ROLE authenticated;
SELECT pg_temp.aa_as(pg_temp.aa(20));
SELECT pg_temp.aa_allowed(pg_temp.aa_signup('parent', 'Guardian A'), '0 CONTROL guardian A signs up and claims their roster rows');
SELECT pg_temp.aa_as(pg_temp.aa(21));
SELECT pg_temp.aa_allowed(pg_temp.aa_signup('parent', 'Guardian B'), '0 CONTROL guardian B signs up and claims their roster rows');

-- ── 1. Nothing approved yet: nothing listed ────────────────────────────────
SELECT pg_temp.aa_as(pg_temp.aa(20));
SELECT pg_temp.aa_check(pg_temp.aa_list() = '', '1 CONTROL before any approval the list is empty', pg_temp.aa_list());

-- ── 2. Guardian A approves both siblings; neither has an account ───────────
SELECT pg_temp.aa_allowed(pg_temp.aa_consent(pg_temp.aa(70)), '2 CONTROL guardian A approves Sam');
SELECT pg_temp.aa_allowed(pg_temp.aa_consent(pg_temp.aa(71)), '2 CONTROL guardian A approves Tia');
SELECT pg_temp.aa_check(pg_temp.aa_list() = '70:Sam 71:Tia',
  '2 G6 the guardian sees both approved children who have no account yet (first names only)', pg_temp.aa_list());
SELECT pg_temp.aa_check((SELECT bool_and(approved_at IS NOT NULL AND approved_at <= now())
  FROM public.get_my_approved_children_awaiting_signup()), '2 G6 each row says when it was approved');

-- ── 3. Another guardian sees only their own consents ───────────────────────
SELECT pg_temp.aa_as(pg_temp.aa(21));
SELECT pg_temp.aa_check(pg_temp.aa_list() = '',
  '3 G3 guardian B does not see guardian A''s approvals, even for the child they share', pg_temp.aa_list());
SELECT pg_temp.aa_allowed(pg_temp.aa_consent(pg_temp.aa(72)), '3 CONTROL guardian B approves Uma');
SELECT pg_temp.aa_check(pg_temp.aa_list() = '72:Uma', '3 G6 guardian B sees their own approval', pg_temp.aa_list());

-- ── 4. Sam signs up: he leaves the list (he is in the family list now) ─────
SELECT pg_temp.aa_as(pg_temp.aa(10));
SELECT pg_temp.aa_allowed(pg_temp.aa_signup('player', 'Sam Synthetic'), '4 CONTROL Sam signs up');
SELECT pg_temp.aa_as(pg_temp.aa(20));
SELECT pg_temp.aa_check(pg_temp.aa_list() = '71:Tia', '4 G6 a child who has signed up leaves the waiting list', pg_temp.aa_list());

-- ── 5. Withdrawing before sign-up empties it, through the existing function ─
SELECT pg_temp.aa_check((SELECT public.withdraw_roster_consent(pg_temp.aa(71))) = 1,
  '5 G6 guardian A withdraws Tia before she has an account');
SELECT pg_temp.aa_check(pg_temp.aa_list() = '', '5 G6 a withdrawn approval leaves the list at once', pg_temp.aa_list());
SELECT pg_temp.aa_check(EXISTS (SELECT 1 FROM public.get_roster_children_awaiting_consent()
  WHERE roster_child_id = pg_temp.aa(71)),
  '5 G6 the withdrawn child is back on the "waiting on your approval" list');

-- ── 6. Who can call it ─────────────────────────────────────────────────────
SELECT pg_temp.aa_as(NULL);
SELECT pg_temp.aa_check(pg_temp.aa_list() = '', '6 G3 a session-less caller gets nothing', pg_temp.aa_list());
RESET ROLE;
SELECT pg_temp.aa_check(
  has_function_privilege('authenticated', 'public.get_my_approved_children_awaiting_signup()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_my_approved_children_awaiting_signup()', 'EXECUTE'),
  '6 only signed-in accounts can call it');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.aa_results;
  IF total <> 17 THEN
    RAISE EXCEPTION 'approved_children_awaiting_signup: % assertions ran; expected exactly 17', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'approved_children_awaiting_signup: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.aa_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'approved_children_awaiting_signup: % checks passed', total;
END;
$test$;
ROLLBACK;

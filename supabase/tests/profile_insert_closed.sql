-- @trak-suite mode=--profile-insert-review in-all=true
-- TRAK-60 [J1]: provision_my_profile is the only way a profile is created, so
-- the checks signup makes cannot be skipped by writing the row directly.
-- Before this, any signed-in account could insert its own player or parent
-- profile through the API.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing profile-insert fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.pi(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE pi_results (description text, passed boolean, detail text);
GRANT INSERT ON pi_results TO authenticated;

CREATE FUNCTION pg_temp.pi_run(statement text, expect_refused boolean, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE refused boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN insufficient_privilege THEN refused := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.pi_results VALUES (description,
    failure IS NULL AND refused = expect_refused,
    coalesce(failure, CASE WHEN refused THEN 'refused' ELSE 'allowed' END));
END;
$test$;

CREATE FUNCTION pg_temp.pi_as(n integer) RETURNS void LANGUAGE sql AS $test$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', pg_temp.pi(n)::text)::text, true);
$test$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.pi(1),  'admin@profile-insert.test',  now()),
  (pg_temp.pi(10), 'coach@profile-insert.test',  now()),
  (pg_temp.pi(20), 'player@profile-insert.test', now()),
  (pg_temp.pi(30), 'parent@profile-insert.test', now());
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.pi(100), pg_temp.pi(1), 'Profile Insert FC', 'PINS01');

SET LOCAL ROLE authenticated;

-- ── Direct inserts are refused for every role ───────────────────────────────
SELECT pg_temp.pi_as(20);
SELECT pg_temp.pi_run(format($$INSERT INTO public.profiles (user_id, role, full_name) VALUES (%L, 'player', 'Direct Player')$$, pg_temp.pi(20)),
  true, 'J1 a player profile cannot be inserted directly');
SELECT pg_temp.pi_as(30);
SELECT pg_temp.pi_run(format($$INSERT INTO public.profiles (user_id, role, full_name) VALUES (%L, 'parent', 'Direct Parent')$$, pg_temp.pi(30)),
  true, 'J1 a parent profile cannot be inserted directly');
SELECT pg_temp.pi_as(10);
SELECT pg_temp.pi_run(format($$INSERT INTO public.profiles (user_id, role, full_name) VALUES (%L, 'coach', 'Direct Coach')$$, pg_temp.pi(10)),
  true, 'J1 a coach profile cannot be inserted directly');

-- ── Signup through provision_my_profile still works ─────────────────────────
SELECT pg_temp.pi_as(20);
SELECT pg_temp.pi_run($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'player', 'full_name', 'Provisioned Player',
  'player_details', jsonb_build_object('date_of_birth', (current_date - interval '19 years')::date::text)))$$,
  false, 'CONTROL a player signs up through provision_my_profile');
SELECT pg_temp.pi_as(30);
SELECT pg_temp.pi_run($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'parent', 'full_name', 'Provisioned Parent'))$$,
  false, 'CONTROL a parent signs up through provision_my_profile');
SELECT pg_temp.pi_as(10);
SELECT pg_temp.pi_run($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'coach', 'full_name', 'Provisioned Coach',
  'coach_details', jsonb_build_object('academy_code', 'PINS01')))$$,
  false, 'CONTROL a coach signs up through provision_my_profile');
SELECT pg_temp.pi_run(format($$UPDATE public.profiles SET full_name = 'Renamed Coach' WHERE user_id = %L$$, pg_temp.pi(10)),
  false, 'CONTROL a user can still edit their own profile');
RESET ROLE;

INSERT INTO pg_temp.pi_results
SELECT 'the three profiles exist with the roles signup gave them',
  count(*) = 3 AND bool_and(full_name LIKE 'Provisioned%' OR full_name = 'Renamed Coach'),
  string_agg(role::text || ':' || full_name, ', ')
FROM public.profiles WHERE user_id IN (pg_temp.pi(10), pg_temp.pi(20), pg_temp.pi(30));

DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.pi_results;
  IF total <> 8 THEN
    RAISE EXCEPTION 'Profile insert closed: % assertions ran; expected exactly 8', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Profile insert closed: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.pi_results WHERE NOT passed);
  END IF;
END;
$test$;

ROLLBACK;

-- @trak-suite mode=--admission-boundary-review in-all=true
-- J1 (MVP Requirements): a player cannot change their own date of birth, and a
-- missing date of birth counts as a minor. TRAK-48 slice 1.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- The date of birth decides whether a guardian must consent. A child who could
-- rewrite it, or leave it empty at signup and fill in an adult date later,
-- would switch the consent gate off for themselves. The player may write it
-- only in the request that creates their profile; Trak corrects it by hand.
--
-- The whole suite is one transaction, so "a later request" is simulated by
-- moving the profile's created_at back, as a real later request would see it.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing admission-boundary fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ab(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ab_results (description text, passed boolean, detail text);
GRANT INSERT ON ab_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ab_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.ab_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.ab_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.ab_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.ab_as(p_uid uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text, 'email', p_email)::text, true);
END;
$test$;

-- A later request: the profile already existed when it began.
CREATE FUNCTION pg_temp.ab_later(p_uid uuid) RETURNS void LANGUAGE sql AS $test$
  UPDATE public.profiles SET created_at = now() - interval '1 minute' WHERE user_id = p_uid;
$test$;

CREATE FUNCTION pg_temp.ab_dob(p_uid uuid) RETURNS date LANGUAGE sql AS $test$
  SELECT date_of_birth FROM public.player_details WHERE user_id = p_uid;
$test$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.ab(1),  'admin@admission-boundary.test', now()),
  (pg_temp.ab(2),  'coach@admission-boundary.test', now()),
  (pg_temp.ab(20), 'child@admission-boundary.test', now()),
  (pg_temp.ab(21), 'nodob@admission-boundary.test', now());

SELECT set_config('trak.ab_child_dob', (current_date - interval '14 years')::date::text, true);
SELECT set_config('trak.ab_adult_dob', (current_date - interval '19 years')::date::text, true);

-- Slice 3 (TRAK-48): a new player must be on the academy roster, which also
-- supplies their date of birth. The first child is rostered. The second is an
-- account made before slice 3 without a date of birth - the case the DOB lock
-- still has to protect, since a new child can no longer sign up without one.
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.ab(1), 'club', 'Admission Admin'), (pg_temp.ab(2), 'coach', 'Admission Coach'),
  (pg_temp.ab(21), 'player', 'No DOB Synthetic');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.ab(30), pg_temp.ab(1), 'Admission Academy', 'AB-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.ab(2), pg_temp.ab(30));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.ab(40), pg_temp.ab(2), 'Child Synthetic', 'U15');
INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.ab(30), pg_temp.ab(40), current_setting('trak.ab_child_dob')::date, 'child@admission-boundary.test', 'fixture');

-- ── 1. Signup: the request that creates the profile sets the DOB ────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.ab_as(pg_temp.ab(20), 'child@admission-boundary.test');
SELECT pg_temp.ab_allowed(format($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'player', 'full_name', 'Child Synthetic',
  'player_details', jsonb_build_object('date_of_birth', %L, 'position', 'Defender')))$$,
  current_setting('trak.ab_child_dob')),
  '1 CONTROL signup sets the date of birth');

-- The second, pre-slice-3 player repeats signup without one.
SELECT pg_temp.ab_as(pg_temp.ab(21), 'nodob@admission-boundary.test');
SELECT pg_temp.ab_allowed($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'player', 'full_name', 'No DOB Synthetic'))$$,
  '1 CONTROL an existing player without a date of birth repeats signup');

RESET ROLE;
SELECT pg_temp.ab_later(pg_temp.ab(20));
SELECT pg_temp.ab_later(pg_temp.ab(21));
SET LOCAL ROLE authenticated;

-- ── 2. Later requests by the child ─────────────────────────────────────────
SELECT pg_temp.ab_as(pg_temp.ab(20), 'child@admission-boundary.test');
SELECT pg_temp.ab_refused(format('UPDATE public.player_details SET date_of_birth = %L WHERE user_id = %L',
  current_setting('trak.ab_adult_dob'), pg_temp.ab(20)),
  '2 J1 the child cannot change their date of birth directly');
SELECT pg_temp.ab_refused(format($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'player', 'full_name', 'Child Synthetic',
  'player_details', jsonb_build_object('date_of_birth', %L)))$$,
  current_setting('trak.ab_adult_dob')),
  '2 J1 the child cannot change their date of birth by signing up again');
SELECT pg_temp.ab_refused(format('UPDATE public.player_details SET date_of_birth = NULL WHERE user_id = %L', pg_temp.ab(20)),
  '2 J1 the child cannot clear their date of birth');
SELECT pg_temp.ab_allowed(format($$UPDATE public.player_details SET position = 'Midfielder' WHERE user_id = %L$$, pg_temp.ab(20)),
  '2 CONTROL the child can still edit other details');
SELECT pg_temp.ab_allowed(format($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'player', 'full_name', 'Child Synthetic',
  'player_details', jsonb_build_object('date_of_birth', %L)))$$,
  current_setting('trak.ab_child_dob')),
  '2 CONTROL repeating signup with the same date of birth is allowed');

-- The empty-then-adult bypass.
SELECT pg_temp.ab_as(pg_temp.ab(21), 'nodob@admission-boundary.test');
SELECT pg_temp.ab_refused(format($$SELECT public.provision_my_profile(jsonb_build_object(
  'role', 'player', 'full_name', 'No DOB Synthetic',
  'player_details', jsonb_build_object('date_of_birth', %L)))$$,
  current_setting('trak.ab_adult_dob')),
  '2 J1 a child who signed up without a date of birth cannot add one later');
SELECT pg_temp.ab_refused(format('INSERT INTO public.player_details (user_id, date_of_birth) VALUES (%L, %L)',
  pg_temp.ab(21), current_setting('trak.ab_adult_dob')),
  '2 J1 nor by inserting their details directly');

-- ── 3. Trak corrects it by hand (J3) ───────────────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.ab_allowed(format('UPDATE public.player_details SET date_of_birth = %L WHERE user_id = %L',
  (current_date - interval '15 years')::date, pg_temp.ab(20)),
  '3 CONTROL an operator can correct a date of birth');
RESET ROLE;

-- Nothing refused above reached the table.
INSERT INTO pg_temp.ab_results
SELECT '4 the child''s date of birth is only the operator''s correction',
  pg_temp.ab_dob(pg_temp.ab(20)) = (current_date - interval '15 years')::date,
  coalesce(pg_temp.ab_dob(pg_temp.ab(20))::text, 'null');
INSERT INTO pg_temp.ab_results
SELECT '4 the second child still has no date of birth',
  pg_temp.ab_dob(pg_temp.ab(21)) IS NULL,
  coalesce(pg_temp.ab_dob(pg_temp.ab(21))::text, 'null');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.ab_results;
  IF total <> 12 THEN
    RAISE EXCEPTION 'Admission boundary: % assertions ran; expected exactly 12', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Admission boundary: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.ab_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Admission boundary: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

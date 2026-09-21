-- @trak-suite mode=--player-age-timezone-review in-all=true
-- Synthetic-only role-level regression. Extreme zones straddle the UTC date at
-- every wall-clock time, so the old helper fails without freezing the DB clock.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing age fixtures outside the disposable test harness';
  END IF;
END;
$test$;
CREATE FUNCTION pg_temp.age_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE age_cases (id uuid, dob date, expected_age integer, consent_required boolean);
-- Consent threshold is deliberately unchanged; this tests the existing caller
-- at its own boundary without baking a new product policy into this repair.
INSERT INTO age_cases VALUES
  (pg_temp.age_id(1), (current_date - interval '1 day' - make_interval(years => public.consent_threshold_age()))::date, public.consent_threshold_age(), false),
  (pg_temp.age_id(2), (current_date - make_interval(years => public.consent_threshold_age()))::date, public.consent_threshold_age(), false),
  (pg_temp.age_id(3), (current_date + interval '1 day' - make_interval(years => public.consent_threshold_age()))::date, public.consent_threshold_age() - 1, true),
  (pg_temp.age_id(4), null, null, null),
  (pg_temp.age_id(5), '2012-02-29', extract(year from age(current_date::timestamp, timestamp '2012-02-29'))::integer, null);
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, 'age-' || id || '@test.invalid', now() FROM age_cases;
INSERT INTO public.profiles (user_id, role, full_name)
SELECT id, 'player', 'Synthetic birthday fixture' FROM age_cases;
INSERT INTO public.player_details (user_id, date_of_birth) SELECT id, dob FROM age_cases;
CREATE TEMP TABLE age_results (description text, passed boolean);
CREATE FUNCTION pg_temp.age_assert(ok boolean, description text) RETURNS void LANGUAGE sql AS $test$
  INSERT INTO pg_temp.age_results VALUES (description, ok IS TRUE);
$test$;
GRANT SELECT ON age_cases TO authenticated;
GRANT INSERT ON age_results TO authenticated;
SELECT pg_temp.age_assert(has_function_privilege('authenticated', 'public.player_age_years(uuid)', 'EXECUTE'), 'authenticated retains execute');
SELECT pg_temp.age_assert((SELECT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.player_age_years(uuid)'::regprocedure), 'stable security-definer contract retained');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.age_id(2))::text, true);
DO $test$
DECLARE zone text; fixture record; utc_day date := (now() AT TIME ZONE 'UTC')::date;
  different_dates integer := 0; old_helper_mismatches integer := 0;
BEGIN
  FOREACH zone IN ARRAY ARRAY['UTC', 'Asia/Dubai', 'Europe/Athens', 'America/Los_Angeles', 'Etc/GMT+12', 'Etc/GMT-14'] LOOP
    PERFORM set_config('TimeZone', zone, true);
    IF current_date <> utc_day THEN different_dates := different_dates + 1; END IF;
    FOR fixture IN SELECT * FROM pg_temp.age_cases LOOP
      PERFORM pg_temp.age_assert(public.player_age_years(fixture.id) IS NOT DISTINCT FROM fixture.expected_age,
        zone || ': age for ' || fixture.id);
      IF fixture.consent_required IS NOT NULL THEN
        PERFORM pg_temp.age_assert(public.player_consent_required(fixture.id) = fixture.consent_required,
          zone || ': consent boundary for ' || fixture.id);
        IF extract(year from age(current_date, fixture.dob))::integer <> fixture.expected_age THEN
          old_helper_mismatches := old_helper_mismatches + 1;
        END IF;
      END IF;
    END LOOP;
    PERFORM pg_temp.age_assert(public.player_age_years(pg_temp.age_id(999)) IS NULL, zone || ': missing player remains unknown');
    PERFORM pg_temp.age_assert(current_setting('TimeZone') = zone, zone || ': helper restores caller timezone');
  END LOOP;
  PERFORM pg_temp.age_assert(different_dates > 0, 'zones exercised a different calendar day');
  PERFORM pg_temp.age_assert(old_helper_mismatches > 0, 'negative control: old session-date expression misclassifies birthdays');
END;
$test$;
RESET ROLE;
DO $test$
DECLARE details text;
BEGIN
  SELECT string_agg(description, E'\n' ORDER BY description) INTO details FROM age_results WHERE NOT passed;
  IF details IS NOT NULL THEN
    RAISE EXCEPTION 'Player age timezone assertions failed' USING DETAIL = details;
  END IF;
END;
$test$;
SELECT count(*) AS player_age_timezone_assertions FROM age_results;
ROLLBACK;

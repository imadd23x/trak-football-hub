-- @trak-suite mode=--coach-details-review in-all=true
-- TRAK-87 (G3, Imad 28 Sep): a coach's academy, age group, role and club are
-- set by the academy through Trak, never by the coach. Settings shows them
-- read-only (#171); this is the database half. Staff are set up by Trak
-- (#151), so a coach neither inserts nor updates their own coach_details.
-- Synthetic fixtures only; run after real migrations in a disposable database.
-- The whole suite is one transaction and rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing coach details fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.cd(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98c00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE cd_results (description text, passed boolean, detail text);
GRANT INSERT ON cd_results TO authenticated, service_role;

CREATE FUNCTION pg_temp.cd_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.cd_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Expects the statement to be refused (any error) or to change nothing.
CREATE FUNCTION pg_temp.cd_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text; changed integer;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed > 0 THEN failure := format('changed %s row(s)', changed); END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  INSERT INTO pg_temp.cd_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- ── Fixtures: an academy with one coach, set up by Trak ────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.cd(1), 'admin@coach-details.test', now()),
  (pg_temp.cd(2), 'coach@coach-details.test', now()),
  (pg_temp.cd(3), 'new-coach@coach-details.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES (pg_temp.cd(1), 'club', 'CD Admin');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.cd(50), pg_temp.cd(1), 'CD Academy', 'CD-ACADEMY'),
  (pg_temp.cd(51), pg_temp.cd(1), 'Other Academy', 'CD-OTHER');
SET LOCAL ROLE service_role;
SELECT public.admit_staff_member(pg_temp.cd(2), 'coach', 'CD Coach', pg_temp.cd(50));
UPDATE public.coach_details SET team = 'U14', coach_role = 'Head Coach', current_club = 'CD Academy' WHERE user_id = pg_temp.cd(2);
RESET ROLE;

-- ── 1. The coach can read, not change ──────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.cd(2)::text)::text, true);
SELECT pg_temp.cd_check((SELECT team = 'U14' FROM public.coach_details WHERE user_id = pg_temp.cd(2)),
  '1 CONTROL the coach still reads their own details');
SELECT pg_temp.cd_refused(format($$UPDATE public.coach_details SET team = 'U18' WHERE user_id = %L$$, pg_temp.cd(2)),
  '1 G3 a coach cannot change their own age group');
SELECT pg_temp.cd_refused(format($$UPDATE public.coach_details SET coach_role = 'Director' WHERE user_id = %L$$, pg_temp.cd(2)),
  '1 G3 a coach cannot change their own role');
SELECT pg_temp.cd_refused(format($$UPDATE public.coach_details SET current_club = 'Somewhere Else FC' WHERE user_id = %L$$, pg_temp.cd(2)),
  '1 G3 a coach cannot change their own club');
SELECT pg_temp.cd_refused(format($$UPDATE public.coach_details SET organization_id = %L WHERE user_id = %L$$, pg_temp.cd(51), pg_temp.cd(2)),
  '1 G3 a coach cannot move themselves to another academy');

-- ── 2. A signed-in account cannot create coach details for itself ──────────
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.cd(3)::text)::text, true);
SELECT pg_temp.cd_refused(format($$INSERT INTO public.coach_details (user_id, team, coach_role) VALUES (%L, 'U14', 'Head Coach')$$, pg_temp.cd(3)),
  '2 G3 an account cannot insert its own coach details');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 3. What is stored, and who can set it ──────────────────────────────────
SELECT pg_temp.cd_check((SELECT team = 'U14' AND coach_role = 'Head Coach' AND current_club = 'CD Academy' AND organization_id = pg_temp.cd(50)
    FROM public.coach_details WHERE user_id = pg_temp.cd(2))
  AND NOT EXISTS (SELECT 1 FROM public.coach_details WHERE user_id = pg_temp.cd(3)),
  '3 G3 nothing the coach tried was stored');
SELECT pg_temp.cd_check(
  NOT has_table_privilege('authenticated', 'public.coach_details', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.coach_details', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.coach_details', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.coach_details', 'UPDATE'),
  '3 G3 app roles hold no INSERT or UPDATE privilege on coach_details');
SET LOCAL ROLE service_role;
UPDATE public.coach_details SET team = 'U15' WHERE user_id = pg_temp.cd(2);
SELECT pg_temp.cd_check((SELECT team = 'U15' FROM public.coach_details WHERE user_id = pg_temp.cd(2)),
  '3 CONTROL the operator can still set a coach''s age group');
RESET ROLE;

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.cd_results;
  IF total <> 9 THEN
    RAISE EXCEPTION 'Coach details locked: % assertions ran; expected exactly 9', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Coach details locked: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.cd_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Coach details locked: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

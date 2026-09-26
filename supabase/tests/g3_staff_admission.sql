-- @trak-suite mode=--g3-staff-review in-all=true
-- TRAK-12 (G3): "no academy sees another academy's data." Coaches read their
-- academy's assessments (20260918163000), so academy membership decides who
-- sees a child's record. For the pilot, staff are set up by Trak (decided by
-- Tarek on 26 Sep, option (a) on TRAK-12): no one may make themselves a coach
-- or an academy admin, and no one may join an academy with its join code.
-- The operator creates staff with admit_staff_member (service role only).
-- Existing staff profiles keep working. Synthetic fixtures only; run after
-- real migrations in a disposable database. The whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing G3 staff fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.g3(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE g3_results (description text, passed boolean, detail text);
GRANT INSERT ON g3_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.g3_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

-- Expects a refusal (any SQLSTATE: the point is that it does not happen).
CREATE FUNCTION pg_temp.g3_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text := 'unexpectedly allowed';
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := NULL;
  END;
  INSERT INTO pg_temp.g3_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.g3_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.g3_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.g3_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.g3_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Counts academy A's assessments visible to the current JWT.
CREATE FUNCTION pg_temp.g3_sees_a() RETURNS bigint LANGUAGE sql AS $test$
  SELECT count(*) FROM public.coach_assessments WHERE id = pg_temp.g3(90);
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.g3_sees_a() TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.g3(1),  'admin-a@g3-staff.test',   now()),
  (pg_temp.g3(2),  'coach-a@g3-staff.test',   now()),
  (pg_temp.g3(3),  'admin-b@g3-staff.test',   now()),
  (pg_temp.g3(4),  'coach-b@g3-staff.test',   now()),
  (pg_temp.g3(5),  'coach-x@g3-staff.test',   now()),  -- an existing coach in no academy
  (pg_temp.g3(6),  'player@g3-staff.test',    now()),
  (pg_temp.g3(10), 'new-coach@g3-staff.test', now()),  -- no profile yet
  (pg_temp.g3(11), 'new-admin@g3-staff.test', now()),  -- no profile yet
  (pg_temp.g3(12), 'hired@g3-staff.test',     now());  -- the operator admits this coach
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.g3(1), 'club',   'Admin A'), (pg_temp.g3(2), 'coach', 'Coach A'),
  (pg_temp.g3(3), 'club',   'Admin B'), (pg_temp.g3(4), 'coach', 'Coach B'),
  (pg_temp.g3(5), 'coach',  'Coach X'), (pg_temp.g3(6), 'player', 'Player Synthetic');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.g3(50), pg_temp.g3(1), 'G3 Academy A', 'G3ACADA'),
  (pg_temp.g3(51), pg_temp.g3(3), 'G3 Academy B', 'G3ACADB');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.g3(2), pg_temp.g3(50)), (pg_temp.g3(4), pg_temp.g3(51)), (pg_temp.g3(5), NULL);
INSERT INTO public.squad_players (id, coach_user_id, player_name) VALUES
  (pg_temp.g3(60), pg_temp.g3(2), 'Academy A Child');
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
VALUES (pg_temp.g3(90), pg_temp.g3(2), pg_temp.g3(60), 5, 5, 5, 5, 5, 5);

SET LOCAL ROLE authenticated;

-- ── 1. No one makes themselves staff ───────────────────────────────────────
SELECT pg_temp.g3_as(pg_temp.g3(10));
SELECT pg_temp.g3_refused($$SELECT public.provision_my_profile('{"role":"coach","full_name":"Self-made Coach","coach_details":{"academy_code":"TRK-G3ACADA"}}'::jsonb)$$,
  '1 G3 a new account cannot make itself a coach with an academy code');
SELECT pg_temp.g3_check(pg_temp.g3_sees_a() = 0, '1 G3 the refused would-be coach reads none of academy A''s assessments');
SELECT pg_temp.g3_as(pg_temp.g3(11));
SELECT pg_temp.g3_refused($$SELECT public.provision_my_profile('{"role":"club","full_name":"Self-made Admin","club_details":{"academy_name":"Shadow Academy"}}'::jsonb)$$,
  '1 G3 a new account cannot make itself an academy admin');
SELECT pg_temp.g3_as(pg_temp.g3(6));
SELECT pg_temp.g3_refused($$UPDATE public.profiles SET role = 'coach' WHERE user_id = auth.uid()$$,
  '1 G3 a player cannot make themselves a coach');
RESET ROLE;
SELECT pg_temp.g3_check(
  NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id IN (pg_temp.g3(10), pg_temp.g3(11)))
  AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE admin_user_id = pg_temp.g3(11))
  AND (SELECT role::text FROM public.profiles WHERE user_id = pg_temp.g3(6)) = 'player',
  '1 G3 nothing refused above left a profile, an academy or a changed role');
SET LOCAL ROLE authenticated;

-- ── 2. No one joins an academy with its code ──────────────────────────────
SELECT pg_temp.g3_as(pg_temp.g3(4));
SELECT pg_temp.g3_refused($$SELECT public.join_organization('G3ACADA')$$,
  '2 G3 a coach of academy B cannot move into academy A with its code');
SELECT pg_temp.g3_check(pg_temp.g3_sees_a() = 0, '2 G3 academy B''s coach reads none of academy A''s assessments');
SELECT pg_temp.g3_refused($$SELECT public.provision_my_profile('{"role":"coach","full_name":"Coach B","coach_details":{"academy_code":"TRK-G3ACADA"}}'::jsonb)$$,
  '2 G3 a coach of academy B cannot move into academy A by repeating signup with its code');
SELECT pg_temp.g3_refused(format($$UPDATE public.coach_details SET organization_id = %L WHERE user_id = auth.uid()$$, pg_temp.g3(50)),
  '2 G3 a coach cannot set their own academy directly');
SELECT pg_temp.g3_as(pg_temp.g3(5));
SELECT pg_temp.g3_refused($$SELECT public.join_organization('G3ACADA')$$,
  '2 G3 a coach in no academy cannot join one with its code');
SELECT pg_temp.g3_refused($$SELECT public.get_org_id_by_join_code('G3ACADA')$$,
  '2 G3 an app user cannot look an academy up by its code');
SELECT pg_temp.g3_check(pg_temp.g3_sees_a() = 0, '2 G3 the academy-less coach reads none of academy A''s assessments');
RESET ROLE;
SELECT pg_temp.g3_check(
  (SELECT organization_id FROM public.coach_details WHERE user_id = pg_temp.g3(4)) = pg_temp.g3(51)
  AND (SELECT organization_id FROM public.coach_details WHERE user_id = pg_temp.g3(5)) IS NULL,
  '2 G3 neither coach''s academy changed');
SET LOCAL ROLE authenticated;

-- ── 3. Controls: existing staff keep working; the operator admits staff ───
SELECT pg_temp.g3_as(pg_temp.g3(2));
SELECT pg_temp.g3_allowed($$SELECT public.provision_my_profile('{"role":"coach","full_name":"Coach A"}'::jsonb)$$,
  '3 CONTROL an existing coach repeating signup still works');
SELECT pg_temp.g3_check(pg_temp.g3_sees_a() = 1, '3 CONTROL academy A''s own coach reads its assessment');
SELECT pg_temp.g3_refused($$SELECT public.admit_staff_member(pg_temp.g3(12), 'coach', 'Hired Coach', pg_temp.g3(50))$$,
  '3 G3 an app user cannot call the operator''s staff admission');
RESET ROLE;
-- A real service-role request carries no user in its JWT.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.g3_allowed($$SELECT public.admit_staff_member(pg_temp.g3(12), 'coach', 'Hired Coach', pg_temp.g3(50))$$,
  '3 CONTROL the operator admits a coach to academy A');
SET LOCAL ROLE authenticated;
SELECT pg_temp.g3_as(pg_temp.g3(12));
SELECT pg_temp.g3_check(pg_temp.g3_sees_a() = 1, '3 CONTROL the admitted coach reads academy A''s assessment');
SELECT pg_temp.g3_allowed($$SELECT public.provision_my_profile('{"role":"coach","full_name":"Hired Coach"}'::jsonb)$$,
  '3 CONTROL the admitted coach''s first sign-in completes');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);

-- ── 4. The doors are shut at the grant too, not only in the body ─────────
SELECT pg_temp.g3_check(
  NOT has_function_privilege('authenticated', 'public.admit_staff_member(uuid, text, text, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admit_staff_member(uuid, text, text, uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.admit_staff_member(uuid, text, text, uuid, text)', 'EXECUTE'),
  '4 G3 only the service role can execute admit_staff_member');
SELECT pg_temp.g3_check(
  NOT has_function_privilege('authenticated', 'public.join_organization(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.join_organization(text)', 'EXECUTE'),
  '4 G3 app roles cannot execute join_organization');
SELECT pg_temp.g3_check(
  NOT has_function_privilege('authenticated', 'public.get_org_id_by_join_code(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_org_id_by_join_code(text)', 'EXECUTE'),
  '4 G3 app roles cannot execute get_org_id_by_join_code');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.g3_results;
  IF total <> 22 THEN
    RAISE EXCEPTION 'G3 staff admission: % assertions ran; expected exactly 22', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'G3 staff admission: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.g3_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'G3 staff admission: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

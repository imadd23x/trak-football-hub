-- @trak-suite mode=--demo-academy-review in-all=true
-- TRAK-629: in an academy with the 'demo' switch on, a squad player with no account counts as consented, so the
-- coach sees the squad by name. A player with an account keeps the normal consent rules. Other academies don't move.
-- Synthetic fixtures only; one transaction that rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing demo-academy fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.da(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98d00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE da_results (description text, passed boolean, detail text);
GRANT INSERT ON da_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.da_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.da_check(ok boolean, description text) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.da_results VALUES (description, coalesce(ok, false), NULL);
$test$;

CREATE FUNCTION pg_temp.da_refused(statement text, expected_state text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.da_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- What the coach's squad page is told: the ids still waiting.
CREATE FUNCTION pg_temp.da_pending() RETURNS uuid[] LANGUAGE sql AS $test$
  SELECT public.coach_squad_players_consent_pending(ARRAY[pg_temp.da(60), pg_temp.da(61)]);
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy 50 becomes the demo academy; academy 51 is a real club and never does.
-- 60: demo squad player with no account. 61: demo squad player with an account (11), age unknown.
-- 62: real-club squad player with no account.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.da(1),  'admin@demo-academy.test',   now()),
  (pg_temp.da(2),  'coach@demo-academy.test',   now()),
  (pg_temp.da(3),  'coach@real-club.test',      now()),
  (pg_temp.da(11), 'player@demo-academy.test',  now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.da(1),  'club',   'DA Admin'),
  (pg_temp.da(2),  'coach',  'DA Coach'),
  (pg_temp.da(3),  'coach',  'RC Coach'),
  (pg_temp.da(11), 'player', 'DA Player');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.da(50), pg_temp.da(1), 'DA Demo Academy', 'DA-DEMO'),
  (pg_temp.da(51), pg_temp.da(1), 'DA Real Club',    'DA-REAL');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.da(2), pg_temp.da(50)), (pg_temp.da(3), pg_temp.da(51));
INSERT INTO public.squad_players (id, coach_user_id, organization_id, player_name, age_group, linked_player_id) VALUES
  (pg_temp.da(60), pg_temp.da(2), pg_temp.da(50), 'Ana Synthetic',  'U23', NULL),
  (pg_temp.da(61), pg_temp.da(2), pg_temp.da(50), 'Ben Synthetic',  'U23', pg_temp.da(11)),
  (pg_temp.da(62), pg_temp.da(3), pg_temp.da(51), 'Cleo Synthetic', 'U23', NULL);

-- ── 0. The switch exists and starts off everywhere ─────────────────────────
SELECT pg_temp.da_check(NOT EXISTS (SELECT 1 FROM public.academy_features WHERE feature = 'demo'),
  '0 no academy has the demo switch on after the migration');

-- ── 1. Switch off: nothing changes ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.da_as(pg_temp.da(2));
SELECT pg_temp.da_check(public.coach_squad_player_consent_required(pg_temp.da(60)),
  '1 CONTROL switch off: a squad player with no account waits for consent');
SELECT pg_temp.da_check(pg_temp.da_pending() @> ARRAY[pg_temp.da(60), pg_temp.da(61)],
  '1 CONTROL switch off: the squad page lists both players as waiting');
SELECT pg_temp.da_check(public.coach_squad_player_wait_reason(pg_temp.da(60)) <> 'ready',
  '1 CONTROL switch off: the wait reason is not ready');

-- An app role can't read or turn on the switch, so no coach or admin can make their own academy a demo.
SELECT pg_temp.da_refused($$INSERT INTO public.academy_features (organization_id, feature)
  VALUES ('98d00000-0000-0000-0000-000000000050', 'demo')$$, '42501',
  '1 a coach cannot switch demo on for their own academy');
SELECT pg_temp.da_as(pg_temp.da(1));
SELECT pg_temp.da_refused($$INSERT INTO public.academy_features (organization_id, feature)
  VALUES ('98d00000-0000-0000-0000-000000000051', 'demo')$$, '42501',
  '1 an academy admin cannot switch demo on either');

-- ── 2. The operator switches demo on for academy 50 ────────────────────────
RESET ROLE;
INSERT INTO public.academy_features (organization_id, feature) VALUES (pg_temp.da(50), 'demo');

SET LOCAL ROLE authenticated;
SELECT pg_temp.da_as(pg_temp.da(2));
SELECT pg_temp.da_check(NOT public.coach_squad_player_consent_required(pg_temp.da(60)),
  '2 TRAK-629 demo on: a squad player with no account counts as consented');
SELECT pg_temp.da_check(NOT trak_private.squad_player_consent_required(pg_temp.da(60)),
  '2 TRAK-629 demo on: the write policies let the coach record for that player');
SELECT pg_temp.da_check(public.coach_squad_player_wait_reason(pg_temp.da(60)) = 'ready',
  '2 TRAK-629 demo on: the wait reason is ready, so the squad shows the name');
SELECT pg_temp.da_check(pg_temp.da_pending() = ARRAY[pg_temp.da(61)],
  '2 TRAK-629 demo on: the squad page lists only the player with an account as waiting');

-- A player with an account keeps the normal rules: unknown age means consent is still required.
SELECT pg_temp.da_check(public.coach_squad_player_consent_required(pg_temp.da(61)),
  '2 TRAK-629 demo on: a squad player WITH an account still waits for consent');

-- Another academy does not move.
SELECT pg_temp.da_as(pg_temp.da(3));
SELECT pg_temp.da_check(public.coach_squad_player_consent_required(pg_temp.da(62)),
  '2 TRAK-629 another academy keeps waiting for consent');

-- ── 3. Switched off again, the demo squad waits again ──────────────────────
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.da(50) AND feature = 'demo';
SET LOCAL ROLE authenticated;
SELECT pg_temp.da_as(pg_temp.da(2));
SELECT pg_temp.da_check(public.coach_squad_player_consent_required(pg_temp.da(60)),
  '3 TRAK-629 demo off again: the player with no account waits again');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.da_results;
  IF total <> 13 THEN
    RAISE EXCEPTION 'Demo academy: % assertions ran; expected exactly 13', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Demo academy: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.da_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Demo academy: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

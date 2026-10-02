-- @trak-suite mode=--wait-reason-review in-all=true
-- TRAK-99 (J5): the coach's squad says WHY a player can't be assessed yet.
-- "Waiting for parent" when no guardian has approved, "waiting for the player
-- to sign up" when a guardian has approved but the child has no account yet.
-- The write gate itself (squad_player_consent_required) must not move.
-- Synthetic fixtures only; one transaction that rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing wait-reason fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.wr(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98990000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE wr_results (description text, passed boolean, detail text);
GRANT INSERT ON wr_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.wr_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.wr_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.wr_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.wr_refused(statement text, expected_state text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.wr_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- What the coach's screen would be told for this squad row.
CREATE FUNCTION pg_temp.wr_expect(p_squad uuid, expected text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE got text; failure text;
BEGIN
  BEGIN
    got := public.coach_squad_player_wait_reason(p_squad);
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  IF failure IS NULL AND got IS DISTINCT FROM expected THEN failure := 'got ' || coalesce(got, 'null'); END IF;
  INSERT INTO pg_temp.wr_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.wr_check(ok boolean, description text) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.wr_results VALUES (description, coalesce(ok, false), NULL);
$test$;

CREATE FUNCTION pg_temp.wr_consent(p_roster_child uuid) RETURNS text LANGUAGE sql AS $test$
  SELECT format($$SELECT public.record_roster_consent(%L, 'legal_guardian',
    '{"coaching_records":true,"recognition":false,"parent_visibility":true}'::jsonb,
    '2026-09-12.1', 'Synthetic roster consent.')$$, p_roster_child);
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Squad rows: 60 Ana (approved, then signs up, then withdrawn), 61 Ben (never
-- approved), 62 Cleo (approved then withdrawn before signup), 63 another
-- coach's player. Guardian 20 is rostered for all three of coach 2's children.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.wr(1),  'admin@wait-reason.test',    now()),
  (pg_temp.wr(2),  'coach@wait-reason.test',    now()),
  (pg_temp.wr(3),  'coach-b@wait-reason.test',  now()),
  (pg_temp.wr(10), 'ana@wait-reason.test',      now()),
  (pg_temp.wr(20), 'guardian@wait-reason.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.wr(1), 'club',  'WR Admin'),
  (pg_temp.wr(2), 'coach', 'WR Coach'),
  (pg_temp.wr(3), 'coach', 'WR Coach B');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.wr(50), pg_temp.wr(1), 'WR Academy', 'WR-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.wr(2), pg_temp.wr(50)), (pg_temp.wr(3), pg_temp.wr(50));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.wr(60), pg_temp.wr(2), 'Ana Synthetic',  'U14'),
  (pg_temp.wr(61), pg_temp.wr(2), 'Ben Synthetic',  'U14'),
  (pg_temp.wr(62), pg_temp.wr(2), 'Cleo Synthetic', 'U14'),
  (pg_temp.wr(63), pg_temp.wr(3), 'Dan Synthetic',  'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.wr(70), pg_temp.wr(50), pg_temp.wr(60), '2013-03-04', 'ana@wait-reason.test',  'fixture'),
  (pg_temp.wr(71), pg_temp.wr(50), pg_temp.wr(61), '2013-05-06', 'ben@wait-reason.test',  'fixture'),
  (pg_temp.wr(72), pg_temp.wr(50), pg_temp.wr(62), '2013-07-08', 'cleo@wait-reason.test', 'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by) VALUES
  (pg_temp.wr(70), 'guardian@wait-reason.test', 'fixture'),
  (pg_temp.wr(71), 'guardian@wait-reason.test', 'fixture'),
  (pg_temp.wr(72), 'guardian@wait-reason.test', 'fixture');

SET LOCAL ROLE authenticated;
SELECT pg_temp.wr_as(pg_temp.wr(20));
SELECT pg_temp.wr_allowed($$SELECT public.provision_my_profile('{"role":"parent","full_name":"WR Guardian"}'::jsonb)$$,
  '0 CONTROL the guardian signs up and claims their roster rows');

-- ── 1. Nobody has approved yet ─────────────────────────────────────────────
SELECT pg_temp.wr_as(pg_temp.wr(2));
SELECT pg_temp.wr_expect(pg_temp.wr(60), 'parent', '1 J5 no approval and no account: waiting for a parent');
SELECT pg_temp.wr_expect(pg_temp.wr(61), 'parent', '1 J5 a second unapproved child: waiting for a parent');

-- ── 2. The guardian approves Ana, who has no account yet ───────────────────
SELECT pg_temp.wr_as(pg_temp.wr(20));
SELECT pg_temp.wr_allowed(pg_temp.wr_consent(pg_temp.wr(70)), '2 CONTROL the guardian approves Ana before she has an account');
SELECT pg_temp.wr_as(pg_temp.wr(2));
SELECT pg_temp.wr_expect(pg_temp.wr(60), 'signup', '2 TRAK-99 approved but no account: waiting for the player to sign up');
SELECT pg_temp.wr_check(public.coach_squad_player_consent_required(pg_temp.wr(60)),
  '2 TRAK-99 the write gate is unchanged: the assessment is still refused until she signs up');
SELECT pg_temp.wr_expect(pg_temp.wr(61), 'parent', '2 CONTROL another child''s approval changes nothing for Ben');

-- ── 3. Approved, then withdrawn, before an account (Cleo) ──────────────────
SELECT pg_temp.wr_as(pg_temp.wr(20));
SELECT pg_temp.wr_allowed(pg_temp.wr_consent(pg_temp.wr(72)), '3 CONTROL the guardian approves Cleo');
SELECT pg_temp.wr_as(pg_temp.wr(2));
SELECT pg_temp.wr_expect(pg_temp.wr(62), 'signup', '3 CONTROL Cleo is waiting to sign up while approved');
SELECT pg_temp.wr_as(pg_temp.wr(20));
SELECT pg_temp.wr_allowed($$SELECT public.withdraw_roster_consent('98990000-0000-0000-0000-000000000072')$$,
  '3 CONTROL the guardian withdraws before Cleo has an account');
SELECT pg_temp.wr_as(pg_temp.wr(2));
SELECT pg_temp.wr_expect(pg_temp.wr(62), 'parent', '3 G6 a withdrawn approval is waiting for a parent again, not for signup');

-- ── 4. Ana signs up, then her approval is withdrawn ────────────────────────
SELECT pg_temp.wr_as(pg_temp.wr(10));
SELECT pg_temp.wr_allowed($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', 'Ana Synthetic',
  'player_details', jsonb_build_object('date_of_birth', '2013-03-04', 'position', 'Defender')))$$,
  '4 CONTROL Ana signs up and claims her roster place');
SELECT pg_temp.wr_as(pg_temp.wr(2));
SELECT pg_temp.wr_expect(pg_temp.wr(60), 'ready', '4 J5 approved and signed up: ready to assess');
SELECT pg_temp.wr_check(NOT public.coach_squad_player_consent_required(pg_temp.wr(60)),
  '4 CONTROL "ready" agrees with the write gate');
SELECT pg_temp.wr_as(pg_temp.wr(20));
SELECT pg_temp.wr_allowed($$SELECT public.withdraw_parental_consent('98990000-0000-0000-0000-000000000010')$$,
  '4 CONTROL the guardian withdraws after Ana has signed up');
SELECT pg_temp.wr_as(pg_temp.wr(2));
SELECT pg_temp.wr_expect(pg_temp.wr(60), 'parent', '4 G6 withdrawn after signup: waiting for a parent');
SELECT pg_temp.wr_check(public.coach_squad_player_consent_required(pg_temp.wr(60)),
  '4 CONTROL "parent" agrees with the write gate');

-- ── 5. Only the coach of that squad row may ask ────────────────────────────
SELECT pg_temp.wr_as(pg_temp.wr(3));
SELECT pg_temp.wr_refused($$SELECT public.coach_squad_player_wait_reason('98990000-0000-0000-0000-000000000060')$$, '42501',
  '5 another coach in the same academy cannot read this player''s state');
SELECT pg_temp.wr_as(pg_temp.wr(2));
SELECT pg_temp.wr_refused($$SELECT public.coach_squad_player_wait_reason('98990000-0000-0000-0000-000000000063')$$, '42501',
  '5 a coach cannot read another coach''s player');
SELECT pg_temp.wr_refused($$SELECT public.coach_squad_player_wait_reason('98990000-0000-0000-0000-000000000099')$$, '42501',
  '5 a missing id gets the same refusal as a foreign one');
SELECT pg_temp.wr_as(pg_temp.wr(20));
SELECT pg_temp.wr_refused($$SELECT public.coach_squad_player_wait_reason('98990000-0000-0000-0000-000000000060')$$, '42501',
  '5 a guardian is not a coach');
RESET ROLE;
SELECT pg_temp.wr_check(
  NOT has_function_privilege('anon', 'public.coach_squad_player_wait_reason(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.coach_squad_player_wait_reason(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.coach_squad_player_wait_reason(uuid)', 'EXECUTE'),
  '5 only signed-in accounts can call it');

SELECT set_config('request.jwt.claims', '', true);

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.wr_results;
  IF total <> 22 THEN
    RAISE EXCEPTION 'Coach wait reason: % assertions ran; expected exactly 22', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Coach wait reason: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.wr_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Coach wait reason: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

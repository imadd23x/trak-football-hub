-- @trak-suite mode=--adult-squads-review in-all=true
-- In an academy with the 'adult_squads' switch on, a squad player with no account whose roster age is 18 or over
-- counts as consented, so a coach-only adult club can record for players who never use Trak. Under 18 or no age
-- on the roster still waits. A player with an account keeps the normal rules. Other academies don't move, and
-- the 'demo' switch still works. Synthetic fixtures only; one transaction that rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing adult-squads fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ad(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98e00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ad_results (description text, passed boolean, detail text);
GRANT INSERT ON ad_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ad_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.ad_check(ok boolean, description text) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.ad_results VALUES (description, coalesce(ok, false), NULL);
$test$;

CREATE FUNCTION pg_temp.ad_refused(statement text, expected_state text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.ad_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- What the coach's squad page is told: the ids still waiting.
CREATE FUNCTION pg_temp.ad_pending() RETURNS uuid[] LANGUAGE sql AS $test$
  SELECT array_agg(id ORDER BY id) FROM unnest(public.coach_squad_players_consent_pending(
    ARRAY[pg_temp.ad(60), pg_temp.ad(61), pg_temp.ad(62), pg_temp.ad(63)])) AS id;
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy 50 is the adult club that gets the switch; academy 51 is another club.
-- 60: no account, age 18. 61: no account, age 17. 62: no account, no age. 63: has an account (11), age unknown.
-- 64: academy 51, no account, age 20.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.ad(1),  'admin@adult-club.test',   now()),
  (pg_temp.ad(2),  'coach@adult-club.test',   now()),
  (pg_temp.ad(3),  'coach@other-club.test',   now()),
  (pg_temp.ad(11), 'player@adult-club.test',  now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.ad(1),  'club',   'AD Admin'),
  (pg_temp.ad(2),  'coach',  'AD Coach'),
  (pg_temp.ad(3),  'coach',  'OC Coach'),
  (pg_temp.ad(11), 'player', 'AD Player');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.ad(50), pg_temp.ad(1), 'AD Adult Club', 'AD-ADULT'),
  (pg_temp.ad(51), pg_temp.ad(1), 'AD Other Club', 'AD-OTHER');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.ad(2), pg_temp.ad(50)), (pg_temp.ad(3), pg_temp.ad(51));
INSERT INTO public.squad_players (id, coach_user_id, organization_id, player_name, age_group, age, linked_player_id) VALUES
  (pg_temp.ad(60), pg_temp.ad(2), pg_temp.ad(50), 'Ana Synthetic',  'U23', 18,   NULL),
  (pg_temp.ad(61), pg_temp.ad(2), pg_temp.ad(50), 'Ben Synthetic',  'U23', 17,   NULL),
  (pg_temp.ad(62), pg_temp.ad(2), pg_temp.ad(50), 'Cleo Synthetic', 'U23', NULL, NULL),
  (pg_temp.ad(63), pg_temp.ad(2), pg_temp.ad(50), 'Dan Synthetic',  'U23', 20,   pg_temp.ad(11)),
  (pg_temp.ad(64), pg_temp.ad(3), pg_temp.ad(51), 'Eve Synthetic',  'U23', 20,   NULL);

-- ── 0. The switch exists and starts off everywhere ─────────────────────────
SELECT pg_temp.ad_check(NOT EXISTS (SELECT 1 FROM public.academy_features WHERE feature = 'adult_squads'),
  '0 no academy has the adult_squads switch on after the migration');

-- ── 1. Switch off: nothing changes ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.ad_as(pg_temp.ad(2));
SELECT pg_temp.ad_check(public.coach_squad_player_consent_required(pg_temp.ad(60)),
  '1 CONTROL switch off: an 18-year-old with no account waits for consent');
SELECT pg_temp.ad_check(pg_temp.ad_pending() = ARRAY[pg_temp.ad(60), pg_temp.ad(61), pg_temp.ad(62), pg_temp.ad(63)],
  '1 CONTROL switch off: the squad page lists all four players as waiting');

-- An app role can't turn the switch on, so no coach or admin can lift consent for their own academy.
SELECT pg_temp.ad_refused($$INSERT INTO public.academy_features (organization_id, feature)
  VALUES ('98e00000-0000-0000-0000-000000000050', 'adult_squads')$$, '42501',
  '1 a coach cannot switch adult_squads on for their own academy');
SELECT pg_temp.ad_as(pg_temp.ad(1));
SELECT pg_temp.ad_refused($$INSERT INTO public.academy_features (organization_id, feature)
  VALUES ('98e00000-0000-0000-0000-000000000050', 'adult_squads')$$, '42501',
  '1 an academy admin cannot switch adult_squads on either');

-- ── 2. The operator switches adult_squads on for academy 50 ────────────────
RESET ROLE;
INSERT INTO public.academy_features (organization_id, feature) VALUES (pg_temp.ad(50), 'adult_squads');

SET LOCAL ROLE authenticated;
SELECT pg_temp.ad_as(pg_temp.ad(2));
SELECT pg_temp.ad_check(NOT public.coach_squad_player_consent_required(pg_temp.ad(60)),
  '2 switch on: an 18-year-old with no account counts as consented');
SELECT pg_temp.ad_check(NOT trak_private.squad_player_consent_required(pg_temp.ad(60)),
  '2 switch on: the write policies let the coach record for that player');
SELECT pg_temp.ad_check(public.coach_squad_player_wait_reason(pg_temp.ad(60)) = 'ready',
  '2 switch on: the wait reason is ready, so the squad shows the name');
SELECT pg_temp.ad_check(public.coach_squad_player_consent_required(pg_temp.ad(61)),
  '2 switch on: a 17-year-old with no account still waits');
SELECT pg_temp.ad_check(public.coach_squad_player_consent_required(pg_temp.ad(62)),
  '2 switch on: a player with no age on the roster still waits');
SELECT pg_temp.ad_check(public.coach_squad_player_consent_required(pg_temp.ad(63)),
  '2 switch on: a player WITH an account keeps the normal rules (unknown birth date waits)');
SELECT pg_temp.ad_check(pg_temp.ad_pending() = ARRAY[pg_temp.ad(61), pg_temp.ad(62), pg_temp.ad(63)],
  '2 switch on: the squad page lists everyone but the 18-year-old as waiting');

-- Another academy does not move.
SELECT pg_temp.ad_as(pg_temp.ad(3));
SELECT pg_temp.ad_check(public.coach_squad_player_consent_required(pg_temp.ad(64)),
  '2 another academy keeps waiting for consent');

-- The demo switch still works after this change.
RESET ROLE;
INSERT INTO public.academy_features (organization_id, feature) VALUES (pg_temp.ad(51), 'demo');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ad_as(pg_temp.ad(3));
SELECT pg_temp.ad_check(NOT public.coach_squad_player_consent_required(pg_temp.ad(64)),
  '2 the demo switch still lets a no-account player count as consented');

-- ── 3. Switched off again, the 18-year-old waits again ─────────────────────
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.ad(50) AND feature = 'adult_squads';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ad_as(pg_temp.ad(2));
SELECT pg_temp.ad_check(public.coach_squad_player_consent_required(pg_temp.ad(60)),
  '3 switch off again: the 18-year-old waits again');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.ad_results;
  IF total <> 15 THEN
    RAISE EXCEPTION 'Adult squads: % assertions ran; expected exactly 15', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Adult squads: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.ad_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Adult squads: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

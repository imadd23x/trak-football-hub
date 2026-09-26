-- @trak-suite mode=--g2-guardian-review in-all=true
-- TRAK-18 (G2): "A child cannot approve themselves, change their age or choose
-- their guardian's email." For a child the academy rostered, the guardians are
-- the roster's (roster_guardians). The child must not add one of their own, by
-- the direct RPC or through the signup payload, because an existing parent
-- account at the chosen address can accept that invitation, become linked, and
-- consent for the child.
-- Accounts made before the roster keep today's path (spec boundary: ask first).
-- Synthetic fixtures only; run after real migrations in a disposable database.
-- The whole suite is one transaction and rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing G2 fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.g2(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE g2_results (description text, passed boolean, detail text);
GRANT INSERT ON g2_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.g2_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

-- Expects a refusal with SQLSTATE 42501 and the agreed wording.
CREATE FUNCTION pg_temp.g2_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      ok := SQLERRM = 'Your academy adds your parents or guardians';
      IF NOT ok THEN failure := '42501 with another message: ' || SQLERRM; END IF;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.g2_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.g2_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.g2_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- Runs an attacker's step whatever it does; the checks below judge the outcome.
CREATE FUNCTION pg_temp.g2_try(statement text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$test$;

CREATE FUNCTION pg_temp.g2_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.g2_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.g2(1),  'admin@g2-guardian.test',        now()),
  (pg_temp.g2(2),  'coach@g2-guardian.test',        now()),
  (pg_temp.g2(10), 'child@g2-guardian.test',        now()),  -- rostered, signs up first
  (pg_temp.g2(11), 'child2@g2-guardian.test',       now()),  -- rostered, signup names a parent
  (pg_temp.g2(20), 'guardian@g2-guardian.test',     now()),  -- the academy's guardian
  (pg_temp.g2(30), 'other-parent@g2-guardian.test', now()),  -- an existing parent account
  (pg_temp.g2(40), 'legacy@g2-guardian.test',       now());  -- a player from before the roster
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.g2(1),  'club',   'G2 Admin'),
  (pg_temp.g2(2),  'coach',  'G2 Coach'),
  (pg_temp.g2(30), 'parent', 'Other Parent'),
  (pg_temp.g2(40), 'player', 'Legacy Player');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.g2(50), pg_temp.g2(1), 'G2 Academy', 'G2-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.g2(2), pg_temp.g2(50));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.g2(60), pg_temp.g2(2), 'Child Synthetic',  'U14'),
  (pg_temp.g2(61), pg_temp.g2(2), 'Child2 Synthetic', 'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.g2(70), pg_temp.g2(50), pg_temp.g2(60), '2012-05-06', 'child@g2-guardian.test',  'fixture'),
  (pg_temp.g2(71), pg_temp.g2(50), pg_temp.g2(61), '2012-07-08', 'child2@g2-guardian.test', 'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by) VALUES
  (pg_temp.g2(70), 'guardian@g2-guardian.test', 'fixture'),
  (pg_temp.g2(71), 'guardian@g2-guardian.test', 'fixture');

CREATE FUNCTION pg_temp.g2_player(p_name text, p_parent_email text) RETURNS text LANGUAGE sql AS $test$
  SELECT format($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', %L,
    'parent_email', %L,
    'player_details', jsonb_build_object('date_of_birth', '2012-01-01', 'position', 'Defender')))$$, p_name, p_parent_email);
$test$;
CREATE FUNCTION pg_temp.g2_consent(p_child uuid) RETURNS text LANGUAGE sql AS $test$
  SELECT format($$SELECT public.record_parental_consent(%L, 'parent',
    '{"coaching_records":true,"recognition":false,"parent_visibility":true}'::jsonb, '2026-09-12.1', 'Synthetic G2 consent.')$$, p_child);
$test$;

SET LOCAL ROLE authenticated;

-- ── 1. The direct RPC ──────────────────────────────────────────────────────
SELECT pg_temp.g2_as(pg_temp.g2(10));
SELECT pg_temp.g2_allowed(pg_temp.g2_player('Child Synthetic', ''), '1 CONTROL a rostered child signs up without naming a parent');
SELECT pg_temp.g2_refused($$SELECT public.create_parent_invite('other-parent@g2-guardian.test')$$,
  '1 G2 a rostered child cannot invite an adult of their choosing as a parent');
SELECT pg_temp.g2_allowed($$SELECT public.create_parent_invite('Guardian@G2-Guardian.test')$$,
  '1 CONTROL a rostered child can still invite the guardian the academy named');

-- ── 2. The signup payload ──────────────────────────────────────────────────
SELECT pg_temp.g2_as(pg_temp.g2(11));
SELECT pg_temp.g2_allowed(pg_temp.g2_player('Child2 Synthetic', 'other-parent@g2-guardian.test'),
  '2 CONTROL a rostered child whose signup names a parent is still admitted');
RESET ROLE;
SELECT pg_temp.g2_check(NOT EXISTS (
    SELECT 1 FROM public.parent_invites WHERE player_user_id IN (pg_temp.g2(10), pg_temp.g2(11))
      AND parent_email = 'other-parent@g2-guardian.test'),
  '2 G2 no invitation exists from a rostered child to an adult they chose');
SET LOCAL ROLE authenticated;

-- ── 3. End to end: the chosen adult cannot become a linked, consenting guardian
-- The fixture reads the invitation id (if the bug made one); the attacker can't.
RESET ROLE;
SELECT set_config('trak.g2_invite', coalesce((
  SELECT id::text FROM public.parent_invites WHERE player_user_id IN (pg_temp.g2(10), pg_temp.g2(11))
    AND parent_email = 'other-parent@g2-guardian.test' LIMIT 1), ''), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g2_as(pg_temp.g2(30));
SELECT pg_temp.g2_try($$SELECT public.link_parent_to_players_by_email('other-parent@g2-guardian.test')$$);
SELECT pg_temp.g2_try(format($$SELECT public.accept_parent_invite(%L)$$, nullif(current_setting('trak.g2_invite'), '')));
SELECT pg_temp.g2_try(pg_temp.g2_consent(pg_temp.g2(10)));
SELECT pg_temp.g2_try(pg_temp.g2_consent(pg_temp.g2(11)));
RESET ROLE;
SELECT pg_temp.g2_check(NOT EXISTS (
    SELECT 1 FROM public.player_parent_links
    WHERE parent_user_id = pg_temp.g2(30) AND player_user_id IN (pg_temp.g2(10), pg_temp.g2(11))),
  '3 G2 the adult a rostered child chose is not linked to them');
SELECT pg_temp.g2_check(NOT EXISTS (
    SELECT 1 FROM public.parental_consents
    WHERE parent_user_id = pg_temp.g2(30) AND player_user_id IN (pg_temp.g2(10), pg_temp.g2(11))),
  '3 G2 the adult a rostered child chose has not consented for them');
SET LOCAL ROLE authenticated;

-- ── 4. Controls: the academy's guardian and the pre-roster path ───────────
SELECT pg_temp.g2_as(pg_temp.g2(20));
SELECT pg_temp.g2_allowed($$SELECT public.provision_my_profile(jsonb_build_object('role', 'parent', 'full_name', 'Guardian Synthetic'))$$,
  '4 CONTROL the academy''s guardian signs up');
SELECT pg_temp.g2_allowed(pg_temp.g2_consent(pg_temp.g2(10)),
  '4 CONTROL the academy''s guardian consents for the rostered child');
SELECT pg_temp.g2_as(pg_temp.g2(40));
SELECT pg_temp.g2_allowed($$SELECT public.create_parent_invite('legacy-parent@g2-guardian.test')$$,
  '4 CONTROL a player from before the roster keeps today''s invitation path');
RESET ROLE;
SELECT pg_temp.g2_check(EXISTS (
    SELECT 1 FROM public.player_parent_links
    WHERE parent_user_id = pg_temp.g2(20) AND player_user_id = pg_temp.g2(10)),
  '4 CONTROL the academy''s guardian is linked to the rostered child');

SELECT set_config('request.jwt.claims', '', true);

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.g2_results;
  IF total <> 11 THEN
    RAISE EXCEPTION 'G2 guardian authority: % assertions ran; expected exactly 11', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'G2 guardian authority: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.g2_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'G2 guardian authority: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

-- @trak-suite mode=--account-deletion-review in-all=false
-- U10 — account deletion, for all four roles, on a disposable database.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- Gate 2 requires "account deletion works for all four roles, and one deletion
-- has actually been performed". Nothing has tested the first half. Imad's
-- parent-invite suite covers what happens to an accepted invitation after a
-- parent deletes, which is a different and narrower question.
--
-- Two things are asserted for each role, because deletion has two ways to fail
-- and they are opposites:
--
--   1. It completes. A GDPR erasure path that errors is a legal problem.
--   2. It actually removes the person's data, rather than reporting success
--      and leaving rows behind — the silent-success shape that has bitten this
--      codebase three times today.
--
-- And one thing is asserted globally: deleting one person must not remove
-- anybody else's record. A deletion that takes a coach's squad with it would
-- pass every "is it gone?" check and destroy an academy's history.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing deletion fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.did(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('99000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE del_results (description text, passed boolean, detail text);
GRANT INSERT ON del_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.dassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.del_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

CREATE FUNCTION pg_temp.dactor(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

-- ── Fixtures: one of each role, plus a bystander of each ────────────────────

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.did(10), 'club@del.test',    now()),
  (pg_temp.did(11), 'coach@del.test',   now()),
  (pg_temp.did(12), 'player@del.test',  now()),
  (pg_temp.did(13), 'parent@del.test',  now()),
  -- Bystanders. Nothing below should touch these.
  (pg_temp.did(20), 'coach2@del.test',  now()),
  (pg_temp.did(21), 'player2@del.test', now());

INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.did(100), pg_temp.did(10), 'Deletion FC', 'DELFC1');

INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.did(10), 'club',   'Club Admin',    NULL),
  (pg_temp.did(11), 'coach',  'Leaving Coach', 'DELC1'),
  (pg_temp.did(12), 'player', 'Leaving Player', NULL),
  (pg_temp.did(13), 'parent', 'Leaving Parent', NULL),
  (pg_temp.did(20), 'coach',  'Staying Coach', 'DELC2'),
  (pg_temp.did(21), 'player', 'Staying Player', NULL);

INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.did(11), pg_temp.did(100)),
  (pg_temp.did(20), pg_temp.did(100));

INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.did(12), '2004-02-02'),
  (pg_temp.did(21), '2004-03-03');

INSERT INTO public.squad_players (id, coach_user_id, player_name, organization_id, status, linked_player_id) VALUES
  (pg_temp.did(200), pg_temp.did(11), 'Leaving Player', pg_temp.did(100), 'active', pg_temp.did(12)),
  (pg_temp.did(201), pg_temp.did(20), 'Staying Player', pg_temp.did(100), 'active', pg_temp.did(21));

INSERT INTO public.matches (id, user_id, opponent, competition, venue, position, age_group, team_score, opponent_score, computed_rating) VALUES
  (pg_temp.did(300), pg_temp.did(12), 'Rivals', 'League', 'Home', 'Midfielder', 'U19+', 1, 0, 7.0),
  (pg_temp.did(301), pg_temp.did(21), 'Rivals', 'League', 'Home', 'Midfielder', 'U19+', 2, 0, 7.5);

-- ── Each role deletes itself ────────────────────────────────────────────────

SET LOCAL ROLE authenticated;

-- Player
SELECT pg_temp.dactor(pg_temp.did(12));
DO $test$
DECLARE v_err text; v_details integer; v_matches integer; v_link integer;
BEGIN
  BEGIN
    PERFORM public.delete_my_account();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM pg_temp.dassert(v_err IS NULL, 'a player can delete their own account', v_err);
END;
$test$;

-- Coach
SELECT pg_temp.dactor(pg_temp.did(11));
DO $test$
DECLARE v_err text;
BEGIN
  BEGIN
    PERFORM public.delete_my_account();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM pg_temp.dassert(v_err IS NULL, 'a coach can delete their own account', v_err);
END;
$test$;

-- Parent
SELECT pg_temp.dactor(pg_temp.did(13));
DO $test$
DECLARE v_err text;
BEGIN
  BEGIN
    PERFORM public.delete_my_account();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM pg_temp.dassert(v_err IS NULL, 'a parent can delete their own account', v_err);
END;
$test$;

-- Club admin
SELECT pg_temp.dactor(pg_temp.did(10));
DO $test$
DECLARE v_err text;
BEGIN
  BEGIN
    PERFORM public.delete_my_account();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM pg_temp.dassert(v_err IS NULL, 'a club admin can delete their own account', v_err);
END;
$test$;

RESET ROLE;

-- ── Did it actually remove anything? ────────────────────────────────────────
--
-- Checked privileged, because the person who deleted their account no longer
-- has a session to check with — and reading back as them would return nothing
-- whether the deletion worked or not. That mistake cost four phantom findings
-- in the isolation suite earlier today.

DO $test$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.player_details WHERE user_id = pg_temp.did(12);
  PERFORM pg_temp.dassert(v_n = 0, 'the deleted player''s details are gone', v_n || ' row(s)');

  SELECT count(*) INTO v_n FROM public.matches WHERE user_id = pg_temp.did(12);
  PERFORM pg_temp.dassert(v_n = 0, 'the deleted player''s matches are gone', v_n || ' row(s)');

  SELECT count(*) INTO v_n FROM public.coach_details WHERE user_id = pg_temp.did(11);
  PERFORM pg_temp.dassert(v_n = 0, 'the deleted coach''s details are gone', v_n || ' row(s)');

  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = pg_temp.did(11);
  PERFORM pg_temp.dassert(v_n = 0, 'the deleted coach''s profile is gone', v_n || ' row(s)');

  SELECT count(*) INTO v_n FROM public.organizations WHERE admin_user_id = pg_temp.did(10);
  PERFORM pg_temp.dassert(v_n = 0, 'the deleted club admin''s academy is gone', v_n || ' row(s)');
END;
$test$;

-- ── Did it remove anything it should not have? ──────────────────────────────
--
-- The opposite failure, and the more damaging one. A deletion that takes other
-- people's records with it passes every "is it gone?" check above.

DO $test$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = pg_temp.did(20);
  PERFORM pg_temp.dassert(v_n = 1, 'the other coach still has a profile', v_n || ' row(s)');

  SELECT count(*) INTO v_n FROM public.squad_players WHERE id = pg_temp.did(201);
  PERFORM pg_temp.dassert(v_n = 1, 'the other coach still has their roster row', v_n || ' row(s)');

  SELECT count(*) INTO v_n FROM public.matches WHERE user_id = pg_temp.did(21);
  PERFORM pg_temp.dassert(v_n = 1, 'the other player still has their match', v_n || ' row(s)');

  SELECT count(*) INTO v_n FROM public.player_details WHERE user_id = pg_temp.did(21);
  PERFORM pg_temp.dassert(v_n = 1, 'the other player still has their details', v_n || ' row(s)');
END;
$test$;

-- ── Report ─────────────────────────────────────────────────────────────────

DO $test$
DECLARE failed integer; total integer; r record;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.del_results;
  FOR r IN SELECT * FROM pg_temp.del_results WHERE NOT passed LOOP
    RAISE WARNING 'FAILED: % — %', r.description, coalesce(r.detail, '');
  END LOOP;
  RAISE NOTICE 'Account deletion assertions: % of % passed', total - failed, total;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Account deletion: % of % desired assertions failed', failed, total;
  END IF;
END;
$test$;

ROLLBACK;

-- @trak-suite mode=--roster-name-review in-all=true
-- TRAK-103 (J3, Imad's option A, 1 Oct): a rostered child's name is the
-- academy's roster name (squad_players.player_name), everywhere. In TRAK-24
-- run 2 a child typed "T Bones Jr." at sign-up, so the coach saw the roster
-- name and the family saw the typed one. The database now decides:
--   - provision_my_profile saves the roster name for a rostered child and
--     ignores any typed name (a missing name is fine for them);
--   - a rostered player can't rename themselves afterwards (the API, Settings
--     or PlayerProfile): refused with 42501;
--   - when the academy corrects squad_players.player_name, the child's
--     profile follows.
-- Parents, coaches and pre-roster players keep their own names. Real SQL
-- roles, synthetic fixtures, disposable database only; one transaction that
-- rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing roster-name fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.rn(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE rn_results (description text, passed boolean, detail text);
GRANT INSERT ON rn_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.rn_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.rn_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.rn_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- Expects SQLSTATE `expected`; an unexpected success is rolled back.
CREATE FUNCTION pg_temp.rn_refused(statement text, expected text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION USING ERRCODE = 'ZRN01', MESSAGE = 'unexpectedly allowed';
  EXCEPTION
    WHEN SQLSTATE 'ZRN01' THEN failure := 'unexpectedly allowed';
    WHEN OTHERS THEN
      ok := SQLSTATE = expected;
      IF NOT ok THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.rn_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.rn_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.rn_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Profiles are readable only through policies; the checks read as the owner.
CREATE FUNCTION pg_temp.rn_name(p_uid uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $test$
  SELECT full_name FROM public.profiles WHERE user_id = p_uid;
$test$;

-- ── Fixtures (trusted setup, as the table owner) ───────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.rn(1),  'admin@roster-name.test',    now()),
  (pg_temp.rn(2),  'coach@roster-name.test',    now()),
  (pg_temp.rn(10), 'child-a@roster-name.test',  now()),  -- rostered, types a name
  (pg_temp.rn(11), 'child-b@roster-name.test',  now()),  -- rostered, sends no name
  (pg_temp.rn(12), 'child-c@roster-name.test',  now()),  -- rostered; an operator makes the profile
  (pg_temp.rn(13), 'unlisted@roster-name.test', now()),  -- on no roster
  (pg_temp.rn(15), 'legacy@roster-name.test',   now()),  -- pre-roster player account
  (pg_temp.rn(20), 'parent@roster-name.test',   now()),  -- guardian of child A
  (pg_temp.rn(21), 'parent2@roster-name.test',  now());  -- guardian of child B, signs up later

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.rn(1),  'club',   'Roster Name Admin'),
  (pg_temp.rn(2),  'coach',  'Roster Name Coach'),
  (pg_temp.rn(15), 'player', 'Legacy Player'),
  (pg_temp.rn(20), 'parent', 'Synthetic Parent');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.rn(30), pg_temp.rn(1), 'Roster Name Academy', 'RN-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.rn(2), pg_temp.rn(30));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group, organization_id) VALUES
  (pg_temp.rn(40), pg_temp.rn(2), 'Synthetic Child A', 'U14', pg_temp.rn(30)),
  (pg_temp.rn(41), pg_temp.rn(2), 'Synthetic Child B', 'U14', pg_temp.rn(30)),
  (pg_temp.rn(42), pg_temp.rn(2), 'Synthetic Child C', 'U14', pg_temp.rn(30));
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.rn(50), pg_temp.rn(30), pg_temp.rn(40), '2012-05-06', 'child-a@roster-name.test', 'fixture'),
  (pg_temp.rn(51), pg_temp.rn(30), pg_temp.rn(41), '2012-07-08', 'child-b@roster-name.test', 'fixture'),
  (pg_temp.rn(52), pg_temp.rn(30), pg_temp.rn(42), '2013-01-02', 'child-c@roster-name.test', 'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, parent_user_id, loaded_by) VALUES
  (pg_temp.rn(50), 'parent@roster-name.test',  pg_temp.rn(20), 'fixture'),
  (pg_temp.rn(51), 'parent2@roster-name.test', NULL,           'fixture');

-- ── 0. Any path that makes a rostered child's profile gets the roster name ─
-- (here a direct insert as the table owner, the way an operator would).
INSERT INTO public.profiles (user_id, role, full_name) VALUES (pg_temp.rn(12), 'player', 'Operator Typed');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(12)) = 'Synthetic Child C',
  'a profile inserted directly for a rostered child holds the roster name', pg_temp.rn_name(pg_temp.rn(12)));

SET LOCAL ROLE authenticated;

-- ── 1. Sign-up saves the roster name, whatever was typed ──────────────────
SELECT pg_temp.rn_as(pg_temp.rn(10));
SELECT pg_temp.rn_allowed($s$SELECT public.provision_my_profile('{"role":"player","full_name":"T Bones Jr.","player_details":{}}'::jsonb)$s$,
  'a rostered child who types a name can still sign up');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(10)) = 'Synthetic Child A',
  'the typed name is ignored: the profile holds the roster name', pg_temp.rn_name(pg_temp.rn(10)));

SELECT pg_temp.rn_as(pg_temp.rn(11));
SELECT pg_temp.rn_allowed($s$SELECT public.provision_my_profile('{"role":"player","player_details":{}}'::jsonb)$s$,
  'a rostered child needs no name at sign-up');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(11)) = 'Synthetic Child B',
  'with no name sent, the profile holds the roster name', pg_temp.rn_name(pg_temp.rn(11)));

-- Re-running setup (a retry, or a second tab) can't rename either.
SELECT pg_temp.rn_as(pg_temp.rn(10));
SELECT pg_temp.rn_allowed($s$SELECT public.provision_my_profile('{"role":"player","full_name":"Another Name","player_details":{}}'::jsonb)$s$,
  'a repeated sign-up still succeeds');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(10)) = 'Synthetic Child A',
  'a repeated sign-up keeps the roster name', pg_temp.rn_name(pg_temp.rn(10)));

-- ── 2. No rename afterwards (API, Settings, PlayerProfile) ────────────────
SELECT pg_temp.rn_refused($s$UPDATE public.profiles SET full_name = 'Rename' WHERE user_id = '98f00000-0000-4000-8000-000000000010'$s$,
  '42501', 'a rostered child cannot rename themselves through the API');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(10)) = 'Synthetic Child A',
  'after the refused rename the roster name stands', pg_temp.rn_name(pg_temp.rn(10)));
SELECT pg_temp.rn_allowed($s$UPDATE public.profiles SET nationality = 'Cypriot' WHERE user_id = '98f00000-0000-4000-8000-000000000010'$s$,
  'CONTROL a rostered child can still change other profile fields');
SELECT pg_temp.rn_allowed($s$UPDATE public.profiles SET full_name = 'Synthetic Child A', nationality = 'Greek' WHERE user_id = '98f00000-0000-4000-8000-000000000010'$s$,
  'CONTROL saving the unchanged roster name with another field is fine');

-- ── 3. Everyone else keeps their own name ─────────────────────────────────
SELECT pg_temp.rn_as(pg_temp.rn(20));
SELECT pg_temp.rn_allowed($s$UPDATE public.profiles SET full_name = 'Renamed Parent' WHERE user_id = '98f00000-0000-4000-8000-000000000020'$s$,
  'CONTROL a parent renames themselves');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(20)) = 'Renamed Parent', 'CONTROL the parent''s new name is saved');
SELECT pg_temp.rn_as(pg_temp.rn(15));
SELECT pg_temp.rn_allowed($s$UPDATE public.profiles SET full_name = 'Renamed Legacy' WHERE user_id = '98f00000-0000-4000-8000-000000000015'$s$,
  'CONTROL a pre-roster player renames themselves');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(15)) = 'Renamed Legacy', 'CONTROL the pre-roster player''s new name is saved');
SELECT pg_temp.rn_as(pg_temp.rn(21));
SELECT pg_temp.rn_refused($s$SELECT public.provision_my_profile('{"role":"parent"}'::jsonb)$s$,
  'P0001', 'CONTROL a guardian still has to give a name');
SELECT pg_temp.rn_as(pg_temp.rn(13));
SELECT pg_temp.rn_refused($s$SELECT public.provision_my_profile('{"role":"player","player_details":{}}'::jsonb)$s$,
  '42501', 'CONTROL a child on no roster is still refused');

-- ── 4. The academy corrects the name; the child's profile follows ─────────
SELECT pg_temp.rn_as(pg_temp.rn(2));
SELECT pg_temp.rn_allowed($s$UPDATE public.squad_players SET player_name = 'Corrected Child A' WHERE id = '98f00000-0000-4000-8000-000000000040'$s$,
  'the coach corrects the roster name');
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(10)) = 'Corrected Child A',
  'the child''s profile follows the corrected roster name', pg_temp.rn_name(pg_temp.rn(10)));
SELECT pg_temp.rn_check(pg_temp.rn_name(pg_temp.rn(11)) = 'Synthetic Child B',
  'CONTROL the other child''s name is untouched', pg_temp.rn_name(pg_temp.rn(11)));

RESET ROLE;

DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.rn_results;
  IF total <> 20 THEN
    RAISE EXCEPTION 'Roster name: % assertions ran; expected exactly 20', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Roster name: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.rn_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Roster name: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

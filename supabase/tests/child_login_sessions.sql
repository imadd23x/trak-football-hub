-- @trak-suite mode=--child-sessions-review in-all=true
-- TRAK-104 (J3): a guardian's password reset must sign the child out of every
-- device. Supabase's admin password update leaves existing sessions alive, so
-- reset-child-password calls end_child_login_sessions() for the child login:
-- their auth.sessions rows go (refresh tokens with them), so no device can
-- renew. my_session_is_live() lets an open app see that its session is gone
-- (Supabase: "check that the session_id claim ... corresponds to a row in the
-- auth.sessions table"). Synthetic fixtures; one transaction, rolled back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing child-session fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.cs(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98e00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE cs_results (description text, passed boolean, detail text);
GRANT INSERT ON cs_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.cs_as(p_uid uuid, p_session uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'role', 'authenticated', 'sub', p_uid::text, 'session_id', p_session::text))::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.cs_refused(statement text, expected_state text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.cs_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.cs_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.cs_results VALUES (description, coalesce(ok, false), detail);
$test$;

CREATE FUNCTION pg_temp.cs_sessions(p_user uuid) RETURNS bigint LANGUAGE sql AS $test$
  SELECT count(*) FROM auth.sessions WHERE user_id = p_user;
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- 10 Kai: a guardian-created child login (TRAK-84), signed in on two devices.
-- 11 Lea: an ordinary player account (signed up from an email invitation).
-- 20 the guardian, signed in on one device.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.cs(1),  'admin@child-sessions.test',    now()),
  (pg_temp.cs(2),  'coach@child-sessions.test',    now()),
  (pg_temp.cs(10), 'kai-login@child-sessions.test', now()),
  (pg_temp.cs(11), 'lea@child-sessions.test',       now()),
  (pg_temp.cs(20), 'guardian@child-sessions.test',  now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.cs(1), 'club', 'CS Admin'), (pg_temp.cs(2), 'coach', 'CS Coach');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.cs(50), pg_temp.cs(1), 'CS Academy', 'CS-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.cs(2), pg_temp.cs(50));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.cs(60), pg_temp.cs(2), 'Kai Synthetic', 'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.cs(70), pg_temp.cs(50), pg_temp.cs(60), '2013-03-04', NULL, 'fixture');
INSERT INTO public.child_logins (roster_child_id, username, created_by, auth_user_id) VALUES
  (pg_temp.cs(70), 'kai.striker7', pg_temp.cs(20), pg_temp.cs(10));
INSERT INTO auth.sessions (id, user_id) VALUES
  (pg_temp.cs(101), pg_temp.cs(10)), (pg_temp.cs(102), pg_temp.cs(10)),
  (pg_temp.cs(111), pg_temp.cs(11)),
  (pg_temp.cs(120), pg_temp.cs(20));

-- ── 1. Who may call what ───────────────────────────────────────────────────
SELECT pg_temp.cs_check(
  has_function_privilege('service_role', 'public.end_child_login_sessions(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.end_child_login_sessions(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.end_child_login_sessions(uuid)', 'EXECUTE'),
  '1 only the server key can end a child''s sessions');
SELECT pg_temp.cs_check(
  has_function_privilege('authenticated', 'public.my_session_is_live()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_session_is_live()', 'EXECUTE'),
  '1 a signed-in account can ask whether its own session is live; anon cannot');

-- ── 2. Before the reset: Kai's sessions are live ───────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.cs_as(pg_temp.cs(10), pg_temp.cs(101));
SELECT pg_temp.cs_check(public.my_session_is_live() IS TRUE, '2 CONTROL Kai''s phone sees its session live');
SELECT pg_temp.cs_as(pg_temp.cs(10), pg_temp.cs(111));
SELECT pg_temp.cs_check(public.my_session_is_live() IS FALSE,
  '2 G3 another account''s session id does not count as live for Kai');
SELECT pg_temp.cs_as(pg_temp.cs(10), NULL);
SELECT pg_temp.cs_check(public.my_session_is_live() IS NULL,
  '2 a token with no session_id gets "unknown", never "signed out"');
RESET ROLE;

-- ── 3. The reset ends every session of the child login, and only those ─────
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.cs_check(public.end_child_login_sessions(pg_temp.cs(10)) = 2,
  '3 J3 the reset ends both of Kai''s sessions');
RESET ROLE;
SELECT pg_temp.cs_check(pg_temp.cs_sessions(pg_temp.cs(10)) = 0, '3 J3 Kai has no session left on any device');
SELECT pg_temp.cs_check(pg_temp.cs_sessions(pg_temp.cs(20)) = 1, '3 the guardian''s own session is untouched');
SELECT pg_temp.cs_check(pg_temp.cs_sessions(pg_temp.cs(11)) = 1, '3 another child''s session is untouched');

-- ── 4. After it: Kai's open app sees it is signed out ──────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.cs_as(pg_temp.cs(10), pg_temp.cs(102));
SELECT pg_temp.cs_check(public.my_session_is_live() IS FALSE, '4 J3 Kai''s other phone sees its session gone');
SELECT pg_temp.cs_as(pg_temp.cs(20), pg_temp.cs(120));
SELECT pg_temp.cs_check(public.my_session_is_live() IS TRUE, '4 CONTROL the guardian is still signed in');
RESET ROLE;

-- ── 5. It refuses anyone who is not a guardian-created child login ──────────
SET LOCAL ROLE service_role;
SELECT pg_temp.cs_refused(format('SELECT public.end_child_login_sessions(%L)', pg_temp.cs(11)), '42501',
  '5 an ordinary player account is refused');
SELECT pg_temp.cs_refused(format('SELECT public.end_child_login_sessions(%L)', pg_temp.cs(20)), '42501',
  '5 a guardian account is refused');
RESET ROLE;
SELECT pg_temp.cs_check(pg_temp.cs_sessions(pg_temp.cs(11)) = 1 AND pg_temp.cs_sessions(pg_temp.cs(20)) = 1,
  '5 a refused call ends nothing');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.cs_results;
  IF total <> 14 THEN
    RAISE EXCEPTION 'child_login_sessions: % assertions ran; expected exactly 14', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'child_login_sessions: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.cs_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'child_login_sessions: % of % passed', total - failed, total;
END;
$test$;
ROLLBACK;

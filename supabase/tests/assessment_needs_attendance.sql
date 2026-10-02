-- @trak-suite mode=--assessment-attendance-review in-all=true
-- TRAK-100 (J5), acceptance 3: the database refuses an assessment on a session
-- where the player isn't marked present, whoever writes it, and a player
-- assessed on a session stays marked present there. Assessments with no
-- session (pre-TRAK-68 seed data) and edits that keep the session and player
-- are left alone. Deleting the session or the squad row still cascades.
-- Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing assessment attendance fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.an(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE an_results (description text, passed boolean, detail text);
GRANT INSERT ON an_results TO authenticated, anon, service_role;

CREATE FUNCTION pg_temp.an_as(p_uid uuid) RETURNS void LANGUAGE sql AS $test$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true)::text;
$test$;

CREATE FUNCTION pg_temp.an_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.an_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Refused with exactly this message, or the check fails with what happened.
CREATE FUNCTION pg_temp.an_refused(statement text, message text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text := 'unexpectedly allowed';
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    failure := CASE WHEN SQLERRM = message THEN NULL ELSE SQLSTATE || ': ' || SQLERRM END;
  END;
  INSERT INTO pg_temp.an_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- Allowed and touching exactly `expected` rows; RLS hiding a row is a failure too.
CREATE FUNCTION pg_temp.an_allowed(statement text, expected integer, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE n integer; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> expected THEN failure := n || ' rows, expected ' || expected; END IF;
  EXCEPTION WHEN OTHERS THEN
    failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.an_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- 1 admin, 2 coach, 3 and 4 adult players (no consent needed, so only this
-- rule decides). Squad 20 → player 3, 21 → player 4, 23 a row with no account.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.an(n), 'an-' || n || '@assessment-attendance.test', now()
FROM unnest(ARRAY[1,2,3,4]) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.an(1), 'club', 'Admin'), (pg_temp.an(2), 'coach', 'Coach'),
  (pg_temp.an(3), 'player', 'Player One'), (pg_temp.an(4), 'player', 'Player Two');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.an(50), pg_temp.an(1), 'Attendance Academy', 'ANACAD');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.an(2), pg_temp.an(50));
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.an(3), current_date - interval '20 years'), (pg_temp.an(4), current_date - interval '20 years');
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.an(20), pg_temp.an(2), 'Player One', pg_temp.an(3)),
  (pg_temp.an(21), pg_temp.an(2), 'Player Two', pg_temp.an(4)),
  (pg_temp.an(23), pg_temp.an(2), 'No Account', NULL);

-- 30 both present; 31 no attendance (the rerun's case); 32 One absent;
-- 33 only Two present; 34 One present (deleted later); 35 the no-account row;
-- 36 One present, no assessment yet.
INSERT INTO public.coach_sessions (id, coach_user_id, session_type, title, session_date) VALUES
  (pg_temp.an(30), pg_temp.an(2), 'training', 'Finishing Training', current_date - 1),
  (pg_temp.an(31), pg_temp.an(2), 'training', 'Finishing Training', current_date - 1),
  (pg_temp.an(32), pg_temp.an(2), 'training', 'Set Pieces', current_date - 2),
  (pg_temp.an(33), pg_temp.an(2), 'training', 'Possession', current_date - 3),
  (pg_temp.an(34), pg_temp.an(2), 'training', 'Pressing', current_date - 4),
  (pg_temp.an(35), pg_temp.an(2), 'training', 'Shape', current_date - 5),
  (pg_temp.an(36), pg_temp.an(2), 'training', 'Recovery', current_date - 6);
INSERT INTO public.session_attendance (id, session_id, squad_player_id, status) VALUES
  (pg_temp.an(60), pg_temp.an(30), pg_temp.an(20), 'present'),
  (pg_temp.an(61), pg_temp.an(30), pg_temp.an(21), 'present'),
  (pg_temp.an(62), pg_temp.an(32), pg_temp.an(20), 'absent'),
  (pg_temp.an(63), pg_temp.an(33), pg_temp.an(21), 'present'),
  (pg_temp.an(64), pg_temp.an(34), pg_temp.an(20), 'present'),
  (pg_temp.an(65), pg_temp.an(35), pg_temp.an(23), 'present'),
  (pg_temp.an(67), pg_temp.an(36), pg_temp.an(20), 'present');
-- Written by the operator, so it goes through the rule too (and passes).
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, session_id) VALUES
  (pg_temp.an(74), pg_temp.an(2), pg_temp.an(20), pg_temp.an(34)),
  (pg_temp.an(75), pg_temp.an(2), pg_temp.an(23), pg_temp.an(35));
-- An assessment saved before this rule, on a session the player wasn't at
-- (like e5ec6b10 on prod). Triggers off only for this one fixture row.
SET LOCAL session_replication_role = replica;
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, session_id, organization_id) VALUES
  (pg_temp.an(78), pg_temp.an(2), pg_temp.an(20), pg_temp.an(31), pg_temp.an(50));
SET LOCAL session_replication_role = origin;

-- ── 1. The coach saving an assessment ──────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.an_as(pg_temp.an(2));
SELECT pg_temp.an_allowed(format('INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, session_id) VALUES (%L, %L, %L, %L)',
  pg_temp.an(70), pg_temp.an(2), pg_temp.an(20), pg_temp.an(30)), 1,
  '1 J5 CONTROL the coach assesses a player on a session they were present at');
SELECT pg_temp.an_refused(format('INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, session_id) VALUES (%L, %L, %L)',
  pg_temp.an(2), pg_temp.an(20), pg_temp.an(31)), 'This player is not marked present at that session',
  '1 J5 refused on a session with no attendance at all (the TRAK-24 rerun case)');
SELECT pg_temp.an_refused(format('INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, session_id) VALUES (%L, %L, %L)',
  pg_temp.an(2), pg_temp.an(20), pg_temp.an(32)), 'This player is not marked present at that session',
  '1 J5 refused on a session where the player is marked absent');
SELECT pg_temp.an_refused(format('INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, session_id) VALUES (%L, %L, %L)',
  pg_temp.an(2), pg_temp.an(20), pg_temp.an(33)), 'This player is not marked present at that session',
  '1 J5 refused on a session where only another player was present');
SELECT pg_temp.an_allowed(format('INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, session_id) VALUES (%L, %L, %L, NULL)',
  pg_temp.an(71), pg_temp.an(2), pg_temp.an(20)), 1,
  '1 an assessment with no session (the pre-TRAK-68 shape) is left to the other rules');

-- ── 2. Editing ─────────────────────────────────────────────────────────────
SELECT pg_temp.an_allowed(format('UPDATE public.coach_assessments SET work_rate = 7 WHERE id = %L', pg_temp.an(70)), 1,
  '2 J5 CONTROL editing an assessment in place still saves');
SELECT pg_temp.an_refused(format('UPDATE public.coach_assessments SET session_id = %L WHERE id = %L', pg_temp.an(31), pg_temp.an(70)),
  'This player is not marked present at that session',
  '2 J5 an assessment cannot be moved onto a session the player was not at');
SELECT pg_temp.an_allowed(format('UPDATE public.coach_assessments SET session_id = %L WHERE id = %L', pg_temp.an(36), pg_temp.an(71)), 1,
  '2 J5 a session-less assessment can be given a session the player was at');
SELECT pg_temp.an_allowed(format('UPDATE public.coach_assessments SET work_rate = 6 WHERE id = %L', pg_temp.an(78)), 1,
  '2 an assessment saved before this rule still opens and saves in place');
SELECT pg_temp.an_check((SELECT session_id FROM public.coach_assessments WHERE id = pg_temp.an(78)) = pg_temp.an(31),
  '2 and it keeps its own session');

-- ── 3. Attendance of an assessed player ────────────────────────────────────
SELECT pg_temp.an_refused(format('DELETE FROM public.session_attendance WHERE id = %L', pg_temp.an(60)),
  'A player assessed on this session must stay marked present',
  '3 J5 the coach cannot remove an assessed player from the session');
SELECT pg_temp.an_refused(format('UPDATE public.session_attendance SET status = %L WHERE id = %L', 'absent', pg_temp.an(60)),
  'A player assessed on this session must stay marked present',
  '3 J5 nor mark them absent');
SELECT pg_temp.an_allowed(format('UPDATE public.session_attendance SET minutes_played = 60 WHERE id = %L', pg_temp.an(60)), 1,
  '3 CONTROL other attendance details of an assessed player still save');
SELECT pg_temp.an_allowed(format('DELETE FROM public.session_attendance WHERE id = %L', pg_temp.an(61)), 1,
  '3 CONTROL a player with no assessment there can still be removed');
SELECT pg_temp.an_allowed(format('DELETE FROM public.coach_sessions WHERE id = %L', pg_temp.an(34)), 1,
  '3 deleting the whole session still works');
SELECT pg_temp.an_check(
  (SELECT session_id IS NULL FROM public.coach_assessments WHERE id = pg_temp.an(74))
  AND NOT EXISTS (SELECT 1 FROM public.session_attendance WHERE session_id = pg_temp.an(34)),
  '3 and the assessment stays, with no session, as before');

-- ── 4. Every role, the operator too ────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.an_refused(format('INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, session_id) VALUES (%L, %L, %L)',
  pg_temp.an(2), pg_temp.an(21), pg_temp.an(31)), 'This player is not marked present at that session',
  '4 the secret key cannot write one either');
RESET ROLE;
SELECT pg_temp.an_refused(format('DELETE FROM public.session_attendance WHERE id = %L', pg_temp.an(65)),
  'A player assessed on this session must stay marked present',
  '4 nor can the database owner remove an assessed player''s attendance');
SELECT pg_temp.an_allowed(format('INSERT INTO public.session_attendance (id, session_id, squad_player_id, status) VALUES (%L, %L, %L, %L)',
  pg_temp.an(66), pg_temp.an(35), pg_temp.an(23), 'present'), 1, '4 fixture: a duplicate attendance row');
SELECT pg_temp.an_allowed(format('DELETE FROM public.session_attendance WHERE id = %L', pg_temp.an(65)), 1,
  '4 a duplicate row can go while another still marks the player present');
SELECT pg_temp.an_allowed(format('DELETE FROM public.squad_players WHERE id = %L', pg_temp.an(23)), 1,
  '4 deleting the squad row still cascades');
SELECT pg_temp.an_check(NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = pg_temp.an(75))
  AND NOT EXISTS (SELECT 1 FROM public.session_attendance WHERE squad_player_id = pg_temp.an(23)),
  '4 and takes its assessment and attendance with it');
SELECT pg_temp.an_check(
  to_regprocedure('trak_private.require_assessed_player_present()') IS NOT NULL
  AND to_regprocedure('trak_private.keep_assessed_attendance()') IS NOT NULL
  AND NOT has_function_privilege('authenticated', 'trak_private.require_assessed_player_present()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'trak_private.require_assessed_player_present()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'trak_private.require_assessed_player_present()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'trak_private.keep_assessed_attendance()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'trak_private.keep_assessed_attendance()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'trak_private.keep_assessed_attendance()', 'EXECUTE'),
  '4 nobody can call the rule functions directly');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.an_results;
  IF total <> 23 THEN
    RAISE EXCEPTION 'Assessment attendance: % assertions ran; expected exactly 23', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Assessment attendance: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.an_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Assessment attendance: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

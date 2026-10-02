-- @trak-suite mode=--training-type-review in-all=true
-- TRAK-75 [J4]: coach_sessions.training_type holds only the fixed focus labels.
-- Execute against a DISPOSABLE database after replaying migrations.
-- The harness must SET trak.test_database = 'disposable' on this connection.
-- Real roles, no mocks. Everything is rolled back.
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to run training-type fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Assertion failed: %', description;
  END IF;
END;
$test$;

-- Runs the statement and reports the SQLSTATE it raised, or 'allowed'.
CREATE FUNCTION pg_temp.outcome(statement text)
RETURNS text LANGUAGE plpgsql AS $test$
BEGIN
  EXECUTE statement;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.outcome(text) TO authenticated;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a7500000-0000-0000-0000-000000000001', 'coach@training-type.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('a7500000-0000-0000-0000-000000000001', 'coach', 'Training Type Coach');

-- The coach writes through the app role, as the form does.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a7500000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'Technical / Set Pieces — theme', 'training', current_date, 'Technical,Set Pieces')
$$) = 'allowed', 'CONTROL a training stores its fixed focus labels');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'Tactical Training', 'training', current_date, 'Tactical')
$$) = 'allowed', 'CONTROL a single label, as production already holds');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'Match', 'match', current_date, NULL)
$$) = 'allowed', 'CONTROL a session with no training_type');

SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'x', 'training', current_date, 'Worked on Alex''s first touch')
$$) = '23514', 'free text cannot be stored as the family-visible focus');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'x', 'training', current_date, 'Tactical,private words')
$$) = '23514', 'a known label cannot smuggle free text alongside it');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'x', 'training', current_date, 'Tactical, Technical')
$$) = '23514', 'labels are stored exactly, with no padding');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'x', 'training', current_date, '')
$$) = '23514', 'an empty focus is NULL, not an empty string');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  INSERT INTO public.coach_sessions (coach_user_id, title, session_type, session_date, training_type)
  VALUES ('a7500000-0000-0000-0000-000000000001', 'vs Rivals', 'match', current_date, 'Tactical')
$$) = '23514', 'only a training has a training focus');
SELECT pg_temp.assert_true(pg_temp.outcome($$
  UPDATE public.coach_sessions SET training_type = 'anything the coach typed'
  WHERE coach_user_id = 'a7500000-0000-0000-0000-000000000001' AND training_type = 'Tactical'
$$) = '23514', 'an update cannot put free text there either');
RESET ROLE;

ROLLBACK;

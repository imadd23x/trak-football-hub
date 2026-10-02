-- @trak-suite mode=--meeting-requests-review in-all=true
-- TRAK-59 [G5]: meeting requests are not in the pilot, and the only writer in
-- the app is an unimported component. Their one policy checked nothing but
-- coach_user_id, so a coach could write one about any child's roster row.
-- The table is closed to app roles; service_role keeps access.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing meeting-request fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE TEMP TABLE mr_results (description text, passed boolean, detail text);
GRANT INSERT ON mr_results TO authenticated, service_role;

CREATE FUNCTION pg_temp.mr_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.mr_results VALUES (description, ok, failure);
END;
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.mr_refused(text, text) TO authenticated;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('98400000-0000-0000-0000-000000000010', 'coach@meeting-requests.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('98400000-0000-0000-0000-000000000010', 'coach', 'Meeting Coach');
INSERT INTO public.squad_players (id, coach_user_id, player_name) VALUES
  ('98400000-0000-0000-0000-000000000100', '98400000-0000-0000-0000-000000000010', 'Meeting Synthetic');
INSERT INTO public.meeting_requests (id, coach_user_id, squad_player_id, reason) VALUES
  ('98400000-0000-0000-0000-000000000200', '98400000-0000-0000-0000-000000000010',
   '98400000-0000-0000-0000-000000000100', 'existing');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"98400000-0000-0000-0000-000000000010"}', true);
SELECT pg_temp.mr_refused($$INSERT INTO public.meeting_requests (coach_user_id, squad_player_id, reason)
  VALUES ('98400000-0000-0000-0000-000000000010', '98400000-0000-0000-0000-000000000100', 'new')$$,
  'G5 a coach cannot create a meeting request');
SELECT pg_temp.mr_refused('SELECT count(*) FROM public.meeting_requests',
  'G5 a coach cannot read meeting requests');
SELECT pg_temp.mr_refused($$UPDATE public.meeting_requests SET reason = 'changed'$$,
  'G5 a coach cannot change a meeting request');
SELECT pg_temp.mr_refused('DELETE FROM public.meeting_requests',
  'G5 a coach cannot delete a meeting request');
RESET ROLE;

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.mr_results
SELECT 'CONTROL service_role still reads meeting requests', count(*) = 1, count(*)::text
FROM public.meeting_requests;
RESET ROLE;

DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.mr_results;
  IF total <> 5 THEN
    RAISE EXCEPTION 'Meeting requests closed: % assertions ran; expected exactly 5', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Meeting requests closed: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.mr_results WHERE NOT passed);
  END IF;
END;
$test$;

ROLLBACK;

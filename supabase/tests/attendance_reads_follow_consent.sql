-- @trak-suite mode=--attendance-reads-review in-all=true
-- TRAK-147 (G6): a child reads their own attendance rows only while their
-- consent is active, like assessments, awards and coach-logged matches
-- (family_reads_follow_consent). Before this, "Players can read own attendance"
-- had no consent check, so a withdrawn child still read the raw rows (Codex
-- audit, 9 Oct). Withdrawal hides; it deletes nothing. Coaches are unchanged,
-- and an adult needs no consent. Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing attendance read fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ar(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ar_results (description text, passed boolean, detail text);
GRANT INSERT ON ar_results TO authenticated, anon;

CREATE FUNCTION pg_temp.ar_as(p_uid uuid) RETURNS void LANGUAGE sql AS $test$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true)::text;
$test$;

CREATE FUNCTION pg_temp.ar_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.ar_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Attendance rows the caller can read straight from the table.
SET LOCAL check_function_bodies = off;
CREATE FUNCTION pg_temp.ar_seen() RETURNS bigint LANGUAGE sql AS $test$
  SELECT count(*) FROM public.session_attendance WHERE session_id = pg_temp.ar(30);
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.ar_seen() TO authenticated;

-- 1 admin, 2 coach, 3 child A (10), 4 child B (10), 5 parent of A,
-- 6 parent of B, 8 adult player (20).
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.ar(n), 'ar-' || n || '@attendance-reads.test', now()
FROM unnest(ARRAY[1,2,3,4,5,6,8]) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.ar(1), 'club', 'Admin'), (pg_temp.ar(2), 'coach', 'Coach'),
  (pg_temp.ar(3), 'player', 'Child A'), (pg_temp.ar(4), 'player', 'Child B'),
  (pg_temp.ar(5), 'parent', 'Parent A'), (pg_temp.ar(6), 'parent', 'Parent B'),
  (pg_temp.ar(8), 'player', 'Adult Player');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.ar(50), pg_temp.ar(1), 'Attendance Reads Academy', 'ARACAD');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.ar(2), pg_temp.ar(50));
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.ar(3), current_date - interval '10 years'), (pg_temp.ar(4), current_date - interval '10 years'),
  (pg_temp.ar(8), current_date - interval '20 years');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES
  (pg_temp.ar(3), pg_temp.ar(5)), (pg_temp.ar(4), pg_temp.ar(6));
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.ar(20), pg_temp.ar(2), 'Child A', pg_temp.ar(3)),
  (pg_temp.ar(21), pg_temp.ar(2), 'Child B', pg_temp.ar(4)),
  (pg_temp.ar(23), pg_temp.ar(2), 'Adult Player', pg_temp.ar(8));
INSERT INTO public.coach_sessions (id, coach_user_id, session_type, title, session_date) VALUES
  (pg_temp.ar(30), pg_temp.ar(2), 'training', 'Synthetic training', current_date - 1);
INSERT INTO public.session_attendance (session_id, squad_player_id, status) VALUES
  (pg_temp.ar(30), pg_temp.ar(20), 'present'), (pg_temp.ar(30), pg_temp.ar(21), 'present'),
  (pg_temp.ar(30), pg_temp.ar(23), 'present');

-- Consent through each parent's own RPC, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ar_as(pg_temp.ar(5));
SELECT public.record_parental_consent(pg_temp.ar(3), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT pg_temp.ar_as(pg_temp.ar(6));
SELECT public.record_parental_consent(pg_temp.ar(4), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');

SELECT pg_temp.ar_as(pg_temp.ar(3));
SELECT pg_temp.ar_check(pg_temp.ar_seen() = 1, '1 CONTROL a consented child reads their own attendance row', pg_temp.ar_seen()::text);

SELECT pg_temp.ar_as(pg_temp.ar(5));
SELECT pg_temp.ar_check(public.withdraw_parental_consent(pg_temp.ar(3)) >= 1, '2 parent A withdraws consent for child A');
SELECT pg_temp.ar_as(pg_temp.ar(3));
SELECT pg_temp.ar_check(pg_temp.ar_seen() = 0, '2 G6 after withdrawal the child reads no attendance rows', pg_temp.ar_seen()::text);
SELECT pg_temp.ar_as(pg_temp.ar(4));
SELECT pg_temp.ar_check(pg_temp.ar_seen() = 1, '2 CONTROL another family''s consent still stands', pg_temp.ar_seen()::text);
SELECT pg_temp.ar_as(pg_temp.ar(8));
SELECT pg_temp.ar_check(pg_temp.ar_seen() = 1, '2 CONTROL an adult player needs no parental consent', pg_temp.ar_seen()::text);
SELECT pg_temp.ar_as(pg_temp.ar(2));
SELECT pg_temp.ar_check(pg_temp.ar_seen() = 3, '2 CONTROL the coach still reads every row, the withdrawn child''s included', pg_temp.ar_seen()::text);

-- Withdrawal hides; it deletes nothing. A new consent shows the row again.
SELECT pg_temp.ar_as(pg_temp.ar(5));
SELECT public.record_parental_consent(pg_temp.ar(3), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT pg_temp.ar_as(pg_temp.ar(3));
SELECT pg_temp.ar_check(pg_temp.ar_seen() = 1, '3 consent again: the child reads their row again', pg_temp.ar_seen()::text);
RESET ROLE;

DO $test$
DECLARE total integer; failed integer; failures text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT passed),
         string_agg(description || coalesce(' [' || detail || ']', ''), E'\n') FILTER (WHERE NOT passed)
  INTO total, failed, failures FROM pg_temp.ar_results;
  IF total <> 7 THEN
    RAISE EXCEPTION 'Attendance reads follow consent: % assertions ran; expected exactly 7', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Attendance reads follow consent: % of % failed: %', failed, total, failures;
  END IF;
  RAISE NOTICE 'Attendance reads follow consent: % of % passed', total - failed, total;
END;
$test$;
ROLLBACK;

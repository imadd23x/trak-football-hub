-- @trak-suite mode=--family-reads-review in-all=true
-- TRAK-13 (G6) read side, for TRAK-6 (J6). One consent covers "coach records,
-- assessments, the published message, and viewing by the child and their
-- linked parents" (MVP J2), and withdrawal "hides published content
-- immediately" (G6). So the child and their linked parents read the coach's
-- assessments, awards and coach-logged matches only while consent is active.
-- Coaches and admins keep reading their records; a player's own self-logged
-- matches stay theirs; an adult needs no consent. Synthetic fixtures; the
-- whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing family read fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.fr(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE fr_results (description text, passed boolean, detail text);
GRANT INSERT ON fr_results TO authenticated, anon;

CREATE FUNCTION pg_temp.fr_as(p_uid uuid) RETURNS void LANGUAGE sql AS $test$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true)::text;
$test$;

CREATE FUNCTION pg_temp.fr_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.fr_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- What the caller can see about one child, through the tables the family
-- screens read: assessments, awards, coach-logged and self-logged matches.
SET LOCAL check_function_bodies = off;
CREATE FUNCTION pg_temp.fr_seen(p_child uuid) RETURNS text LANGUAGE sql AS $test$
  SELECT format('a=%s w=%s mc=%s ms=%s',
    (SELECT count(*) FROM public.coach_assessments ca JOIN public.squad_players sp ON sp.id = ca.squad_player_id
      WHERE sp.linked_player_id = p_child),
    (SELECT count(*) FROM public.recognition_awards ra JOIN public.squad_players sp ON sp.id = ra.squad_player_id
      WHERE sp.linked_player_id = p_child),
    (SELECT count(*) FROM public.matches m WHERE m.user_id = p_child AND m.logged_by_role = 'coach'),
    (SELECT count(*) FROM public.matches m WHERE m.user_id = p_child AND m.logged_by_role = 'player'));
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.fr_seen(uuid) TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- 1 admin, 2 coach, 3 child A (10), 4 sibling (12), 5 parent of both,
-- 6 child C (10, no consent), 7 parent of C, 8 adult player (20).
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.fr(n), 'fr-' || n || '@family-reads.test', now()
FROM unnest(ARRAY[1,2,3,4,5,6,7,8]) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.fr(1), 'club', 'Admin'), (pg_temp.fr(2), 'coach', 'Coach'),
  (pg_temp.fr(3), 'player', 'Child A'), (pg_temp.fr(4), 'player', 'Sibling A'),
  (pg_temp.fr(5), 'parent', 'Parent A'), (pg_temp.fr(6), 'player', 'Child C'),
  (pg_temp.fr(7), 'parent', 'Parent C'), (pg_temp.fr(8), 'player', 'Adult Player');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.fr(50), pg_temp.fr(1), 'Family Reads Academy', 'FRACAD');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.fr(2), pg_temp.fr(50));
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.fr(3), current_date - interval '10 years'), (pg_temp.fr(4), current_date - interval '12 years'),
  (pg_temp.fr(6), current_date - interval '10 years'), (pg_temp.fr(8), current_date - interval '20 years');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES
  (pg_temp.fr(3), pg_temp.fr(5)), (pg_temp.fr(4), pg_temp.fr(5)), (pg_temp.fr(6), pg_temp.fr(7));
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.fr(20), pg_temp.fr(2), 'Child A', pg_temp.fr(3)),
  (pg_temp.fr(21), pg_temp.fr(2), 'Sibling A', pg_temp.fr(4)),
  (pg_temp.fr(22), pg_temp.fr(2), 'Child C', pg_temp.fr(6)),
  (pg_temp.fr(23), pg_temp.fr(2), 'Adult Player', pg_temp.fr(8));
INSERT INTO public.coach_assessments
  (id, coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
SELECT pg_temp.fr(30 + n), pg_temp.fr(2), pg_temp.fr(20 + n), 7,7,7,7,7,7 FROM generate_series(0, 3) n;
INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type)
SELECT pg_temp.fr(40 + n), pg_temp.fr(2), pg_temp.fr(20 + n), 'effort' FROM generate_series(0, 3) n;
-- Matches: the coach's record of each child, plus a match child A and child C
-- logged themselves.
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group, logged_by, logged_by_role) VALUES
  (pg_temp.fr(60), pg_temp.fr(3), 'CM', 'League', 'Home', 'U11', pg_temp.fr(2), 'coach'),
  (pg_temp.fr(61), pg_temp.fr(3), 'CM', 'Friendly', 'Away', 'U11', pg_temp.fr(3), 'player'),
  (pg_temp.fr(62), pg_temp.fr(4), 'CB', 'League', 'Home', 'U13', pg_temp.fr(2), 'coach'),
  (pg_temp.fr(63), pg_temp.fr(6), 'ST', 'League', 'Home', 'U11', pg_temp.fr(2), 'coach'),
  (pg_temp.fr(64), pg_temp.fr(6), 'ST', 'Friendly', 'Away', 'U11', pg_temp.fr(6), 'player'),
  (pg_temp.fr(65), pg_temp.fr(8), 'GK', 'League', 'Home', 'Adult', pg_temp.fr(2), 'coach');

-- Consent through the parent's own RPC, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.fr_as(pg_temp.fr(5));
SELECT public.record_parental_consent(pg_temp.fr(3), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT public.record_parental_consent(pg_temp.fr(4), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');

-- ── 1. With consent, the family reads everything (controls) ────────────────
SELECT pg_temp.fr_as(pg_temp.fr(3));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(3)) = 'a=1 w=1 mc=1 ms=1',
  '1 CONTROL a consented child reads their assessment, award and both matches', pg_temp.fr_seen(pg_temp.fr(3)));
-- The child tries to relabel the coach's match as their own before a
-- withdrawal, to keep it afterwards.
UPDATE public.matches SET logged_by = pg_temp.fr(3), logged_by_role = 'player' WHERE id = pg_temp.fr(60);
SELECT pg_temp.fr_as(pg_temp.fr(5));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(3)) = 'a=1 w=1 mc=1 ms=1',
  '1 CONTROL their parent reads the same', pg_temp.fr_seen(pg_temp.fr(3)));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(4)) = 'a=1 w=1 mc=1 ms=0',
  '1 CONTROL and the sibling''s', pg_temp.fr_seen(pg_temp.fr(4)));
RESET ROLE;
SELECT pg_temp.fr_check(
  (SELECT logged_by = pg_temp.fr(2) AND logged_by_role = 'coach' FROM public.matches WHERE id = pg_temp.fr(60)),
  '1 G6 a player cannot relabel the coach''s match as self-logged',
  (SELECT logged_by_role || ' by ' || logged_by FROM public.matches WHERE id = pg_temp.fr(60)));
SET LOCAL ROLE authenticated;

-- ── 2. Without consent, no coach records reach the family ─────────────────
SELECT pg_temp.fr_as(pg_temp.fr(6));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(6)) = 'a=0 w=0 mc=0 ms=1',
  '2 G1 an under-18 without consent reads no assessment, award or coach-logged match; their own match stays',
  pg_temp.fr_seen(pg_temp.fr(6)));
SELECT pg_temp.fr_as(pg_temp.fr(7));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(6)) = 'a=0 w=0 mc=0 ms=1',
  '2 G1 nor does their parent, before approving', pg_temp.fr_seen(pg_temp.fr(6)));
SELECT pg_temp.fr_as(pg_temp.fr(8));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(8)) = 'a=1 w=1 mc=1 ms=0',
  '2 CONTROL an adult player needs no parental consent', pg_temp.fr_seen(pg_temp.fr(8)));
SELECT pg_temp.fr_as(pg_temp.fr(2));
SELECT pg_temp.fr_check((SELECT count(*) FROM public.coach_assessments WHERE squad_player_id = pg_temp.fr(22)) = 1
  AND (SELECT count(*) FROM public.recognition_awards WHERE squad_player_id = pg_temp.fr(22)) = 1,
  '2 CONTROL the coach still reads their own records about that child');

-- ── 3. Withdrawal hides them at once ──────────────────────────────────────
SELECT pg_temp.fr_as(pg_temp.fr(5));
SELECT pg_temp.fr_check(public.withdraw_parental_consent(pg_temp.fr(3)) >= 1, '3 the parent withdraws for child A');
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(3)) = 'a=0 w=0 mc=0 ms=1',
  '3 G6 after withdrawal the parent reads no assessment, award or coach-logged match', pg_temp.fr_seen(pg_temp.fr(3)));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(4)) = 'a=1 w=1 mc=1 ms=0',
  '3 CONTROL the sibling''s own consent still stands', pg_temp.fr_seen(pg_temp.fr(4)));
SELECT pg_temp.fr_as(pg_temp.fr(3));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(3)) = 'a=0 w=0 mc=0 ms=1',
  '3 G6 nor does the child; their own match stays', pg_temp.fr_seen(pg_temp.fr(3)));
SELECT pg_temp.fr_check((SELECT count(*) FROM public.coach_assessments WHERE id = pg_temp.fr(30)) = 0,
  '3 G6 not even by id');
SELECT pg_temp.fr_as(pg_temp.fr(2));
SELECT pg_temp.fr_check((SELECT count(*) FROM public.coach_assessments WHERE squad_player_id = pg_temp.fr(20)) = 1,
  '3 CONTROL the coach keeps their record');
SELECT pg_temp.fr_as(pg_temp.fr(1));
SELECT pg_temp.fr_check((SELECT count(*) FROM public.coach_assessments WHERE organization_id = pg_temp.fr(50)) = 4,
  '3 CONTROL the academy admin reads all four');

-- ── 4. Consent again brings them back: withdrawal hides, it doesn't delete ──
SELECT pg_temp.fr_as(pg_temp.fr(5));
SELECT public.record_parental_consent(pg_temp.fr(3), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT pg_temp.fr_as(pg_temp.fr(3));
SELECT pg_temp.fr_check(pg_temp.fr_seen(pg_temp.fr(3)) = 'a=1 w=1 mc=1 ms=1',
  '4 CONTROL after the parent approves again, the child reads them again', pg_temp.fr_seen(pg_temp.fr(3)));
RESET ROLE;

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.fr_results;
  IF total <> 16 THEN
    RAISE EXCEPTION 'Family reads follow consent: % assertions ran; expected exactly 16', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Family reads follow consent: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.fr_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Family reads follow consent: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

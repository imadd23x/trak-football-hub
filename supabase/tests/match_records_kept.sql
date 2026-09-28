-- @trak-suite mode=--match-records-review in-all=true
-- TRAK-82 (J4): the coach's record of a child's match is not the child's to
-- erase. "Players can delete own matches" let a signed-in child delete any
-- match row about them, and every match on production is coach-logged
-- (reproduced on production 27 Sep, rolled back). Player logging is cut, so no
-- app role deletes matches; account deletion (delete_my_account, a definer)
-- and the operator still can. Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing match record fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.mk(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97800000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE mk_results (description text, passed boolean, detail text);
GRANT INSERT ON mk_results TO authenticated, anon, service_role;

CREATE FUNCTION pg_temp.mk_as(p_uid uuid) RETURNS void LANGUAGE sql AS $test$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true)::text;
$test$;

CREATE FUNCTION pg_temp.mk_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.mk_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Tries a DELETE as the current caller; records how many rows it removed
-- (0 when refused by the privilege, the policy or both).
CREATE FUNCTION pg_temp.mk_delete(p_match uuid) RETURNS integer LANGUAGE plpgsql AS $test$
DECLARE n integer := 0;
BEGIN
  DELETE FROM public.matches WHERE id = p_match;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN 0;
END;
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.mk_delete(uuid) TO authenticated;

-- Whether the row survived, seen by the owner: a caller may not be able to
-- read it (a parent without consent, a coach), which is not the same as gone.
CREATE FUNCTION pg_temp.mk_exists(p_match uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $test$
  SELECT EXISTS (SELECT 1 FROM public.matches WHERE id = p_match);
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.mk_exists(uuid) TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- 1 coach, 2 child (15), 3 their parent, 4 adult player (20).
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.mk(n), 'mk-' || n || '@match-records.test', now() FROM unnest(ARRAY[1,2,3,4]) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.mk(1), 'coach', 'Coach'), (pg_temp.mk(2), 'player', 'Child'),
  (pg_temp.mk(3), 'parent', 'Parent'), (pg_temp.mk(4), 'player', 'Adult Player');
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.mk(2), current_date - interval '15 years'), (pg_temp.mk(4), current_date - interval '20 years');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES (pg_temp.mk(2), pg_temp.mk(3));
-- The coach's records of each player, and an old match the child logged
-- themselves before player logging was cut.
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group, logged_by, logged_by_role) VALUES
  (pg_temp.mk(10), pg_temp.mk(2), 'CM', 'League', 'Home', 'U16', pg_temp.mk(1), 'coach'),
  (pg_temp.mk(11), pg_temp.mk(2), 'CM', 'Friendly', 'Away', 'U16', pg_temp.mk(2), 'player'),
  (pg_temp.mk(12), pg_temp.mk(4), 'GK', 'League', 'Home', 'Adult', pg_temp.mk(1), 'coach'),
  (pg_temp.mk(13), pg_temp.mk(2), 'CM', 'Cup', 'Home', 'U16', pg_temp.mk(1), 'coach'),
  -- One row per attempt below, so one caller's delete can't hide another's.
  (pg_temp.mk(14), pg_temp.mk(2), 'CM', 'League', 'Away', 'U16', pg_temp.mk(1), 'coach'),
  (pg_temp.mk(15), pg_temp.mk(2), 'CM', 'League', 'Home', 'U16', pg_temp.mk(1), 'coach');

-- The child is consented, as on production: without consent the family can't
-- even see the coach's record (#174), which would hide the bug.
SET LOCAL ROLE authenticated;
SELECT pg_temp.mk_as(pg_temp.mk(3));
SELECT public.record_parental_consent(pg_temp.mk(2), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');

-- ── 1. No app role deletes a match ────────────────────────────────────────
SELECT pg_temp.mk_as(pg_temp.mk(2));
SELECT pg_temp.mk_check(pg_temp.mk_delete(pg_temp.mk(10)) = 0 AND pg_temp.mk_exists(pg_temp.mk(10)),
  '1 J4 a child cannot delete the coach''s record of their match');
SELECT pg_temp.mk_check(pg_temp.mk_delete(pg_temp.mk(11)) = 0 AND pg_temp.mk_exists(pg_temp.mk(11)),
  '1 J4 nor an old match they logged themselves: player logging is cut');
SELECT pg_temp.mk_as(pg_temp.mk(3));
SELECT pg_temp.mk_check(pg_temp.mk_delete(pg_temp.mk(14)) = 0 AND pg_temp.mk_exists(pg_temp.mk(14)),
  '1 J4 nor their parent');
SELECT pg_temp.mk_as(pg_temp.mk(4));
SELECT pg_temp.mk_check(pg_temp.mk_delete(pg_temp.mk(12)) = 0 AND pg_temp.mk_exists(pg_temp.mk(12)),
  '1 J4 nor an adult player');
SELECT pg_temp.mk_as(pg_temp.mk(1));
SELECT pg_temp.mk_check(pg_temp.mk_delete(pg_temp.mk(15)) = 0 AND pg_temp.mk_exists(pg_temp.mk(15)),
  '1 J4 nor the coach, through the table');
RESET ROLE;

-- ── 2. Both barriers, not one (as A1c for assessments, notes and awards) ───
SELECT pg_temp.mk_check(
  NOT has_table_privilege('authenticated', 'public.matches', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.matches', 'DELETE'),
  '2 app roles hold no DELETE privilege on matches');
SELECT pg_temp.mk_check(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matches'
            AND cmd = 'DELETE' AND coalesce(qual, '') IN ('false', '(false)'))
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matches'
            AND cmd IN ('DELETE', 'ALL') AND coalesce(qual, '') NOT IN ('false', '(false)')),
  '2 matches carries only a no-deletion policy for DELETE');

-- ── 3. The ways a match may still go (controls) ───────────────────────────
SET LOCAL ROLE service_role;
WITH d AS (DELETE FROM public.matches WHERE id = pg_temp.mk(13) RETURNING 1)
SELECT pg_temp.mk_check((SELECT count(*) FROM d) = 1, '3 CONTROL the operator can remove a match');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.mk_as(pg_temp.mk(2));
SELECT public.delete_my_account();
RESET ROLE;
SELECT pg_temp.mk_check(NOT EXISTS (SELECT 1 FROM public.matches WHERE user_id = pg_temp.mk(2)),
  '3 CONTROL a child who deletes their account takes their matches with it');
SELECT pg_temp.mk_check(pg_temp.mk_exists(pg_temp.mk(12)),
  '3 CONTROL and nobody else''s');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.mk_results;
  IF total <> 10 THEN
    RAISE EXCEPTION 'Match records kept: % assertions ran; expected exactly 10', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Match records kept: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.mk_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Match records kept: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

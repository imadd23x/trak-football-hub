-- @trak-suite mode=--match-stat-review in-all=true
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- Covers 20260920150000. Asserts that an impossible match record is refused by
-- the DATABASE, not merely by the screen — the RPC is reachable directly, so a
-- client-side rule is a suggestion.
--
-- Every refusal has a positive control beside it, because "refused" and "the
-- fixture never ran" look identical otherwise. The three values named below
-- were each measured as ACCEPTED and STORED before this migration existed.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing match-stat fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ms_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('96000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ms_results (description text, passed boolean, detail text);
-- The assertions run as `authenticated`, so that role must be able to record
-- its own results. Without this the suite fails on the result table rather
-- than on anything it set out to test.
GRANT INSERT ON ms_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ms_assert(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.ms_results VALUES (description, ok IS TRUE, NULL);
END;
$test$;

-- A refusal must be a refusal, not any error. Anything else, success included,
-- is recorded with its SQLSTATE so a false pass cannot hide.
CREATE FUNCTION pg_temp.ms_expect_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE refused boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly succeeded';
  EXCEPTION
    -- raise_exception is the RPC's own message; check_violation is the table
    -- constraint. Either is a correct refusal; both barriers are asserted.
    WHEN raise_exception THEN refused := true;
    WHEN check_violation  THEN refused := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.ms_results VALUES (description, refused, failure);
END;
$test$;

-- ⚠ The helper above cannot tell WHICH barrier refused, and that matters.
--
-- A mutation proved it: deleting the RPC's goals check left every assertion
-- green, because the table constraint caught the row instead. But then the
-- coach sees `matches_goals_in_range` rather than a sentence — which is the
-- entire reason the RPC validates at all. A suite that cannot see the
-- difference would let the readable layer rot away silently.
--
-- So refusals that are supposed to come from the RPC assert the RPC's own
-- SQLSTATE (P0001, raise_exception) AND its message text. The constraint is
-- asserted separately, by a direct write that bypasses the RPC (MS14).
CREATE FUNCTION pg_temp.ms_expect_rpc_refusal(statement text, expected_text text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM ILIKE '%' || expected_text || '%' THEN
        ok := true;
      ELSE
        failure := 'RPC refused with the wrong message: ' || SQLERRM;
      END IF;
    WHEN check_violation THEN
      -- The constraint did the work, so the RPC's readable check is missing.
      failure := 'only the CHECK constraint refused this; the RPC no longer '
              || 'validates it, so a coach sees a constraint name: ' || SQLERRM;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.ms_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.ms_expect_ok(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.ms_results VALUES (description, failure IS NULL, failure);
END;
$test$;


-- ── Fixture: one coach who genuinely holds one player ────────
-- The RPC refuses a coach who does not hold the player (20260917000005), so
-- without a real roster link every assertion below would "pass" for the wrong
-- reason. The positive control at the end proves this fixture works.
INSERT INTO auth.users (id, email) VALUES
  (pg_temp.ms_id(1), 'ms-coach@synthetic.test'),
  (pg_temp.ms_id(2), 'ms-player@synthetic.test'),
  (pg_temp.ms_id(3), 'ms-player-b@synthetic.test'),
  (pg_temp.ms_id(4), 'ms-player-c@synthetic.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (user_id, full_name, role)
VALUES (pg_temp.ms_id(1), 'MS Coach', 'coach'),
       (pg_temp.ms_id(2), 'MS Player', 'player'),
       (pg_temp.ms_id(3), 'MS Player B', 'player'),
       (pg_temp.ms_id(4), 'MS Player C', 'player')
ON CONFLICT DO NOTHING;

INSERT INTO public.coach_details (user_id, organization_id)
VALUES (pg_temp.ms_id(1), NULL)
ON CONFLICT DO NOTHING;

-- 18 or over, so no guardian consent is involved: this suite tests the stat
-- rules. A missing DOB counts as a minor (consent_every_write.sql).
INSERT INTO public.player_details (user_id, date_of_birth)
VALUES (pg_temp.ms_id(2), (current_date - interval '19 years')::date),
       (pg_temp.ms_id(3), (current_date - interval '19 years')::date),
       (pg_temp.ms_id(4), (current_date - interval '19 years')::date)
ON CONFLICT DO NOTHING;

INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, status)
VALUES (pg_temp.ms_id(10), pg_temp.ms_id(1), 'MS Player', pg_temp.ms_id(2), 'active'),
       (pg_temp.ms_id(11), pg_temp.ms_id(1), 'MS Player B', pg_temp.ms_id(3), 'active'),
       (pg_temp.ms_id(12), pg_temp.ms_id(1), 'MS Player C', pg_temp.ms_id(4), 'active')
ON CONFLICT DO NOTHING;

-- One call, varying only the numbers under test. Each accepted call below is a
-- different match, so it names its own opponent: the same coach, date and
-- opponent is one match since TRAK-149, and its scores must agree.
CREATE FUNCTION pg_temp.ms_log(minutes integer, goals integer, assists integer, team_score integer,
                               opponent text DEFAULT 'MS-OPPONENT')
RETURNS text LANGUAGE sql IMMUTABLE AS $test$
  SELECT format(
    'SELECT public.log_match_for_player(%L::uuid, %L, %s, 0, %L, %L, %L, %L, %s, %s, %s, %L, %L, %L, %s)',
    '96000000-0000-0000-0000-000000000002', opponent, team_score,
    'League', 'Home', 'ST', 'U12', minutes, goals, assists,
    'None', 'Fresh', 'Good', 6.5);
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"96000000-0000-0000-0000-000000000001"}', true);


-- ── 1. The three values the database accepted before ─────────
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(90, 999, 0, 999), 'Goals must be between',
  'MS1: 999 goals refused BY THE RPC, in words (was ACCEPTED and stored before 20260920150000)');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(-45, 1, 0, 1), 'Minutes played must be between',
  'MS2: -45 minutes refused BY THE RPC, in words (was ACCEPTED before)');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(90, -3, 0, 5), 'Goals must be between',
  'MS3: -3 goals refused BY THE RPC, in words (was ACCEPTED before)');


-- ── 2. Each rule, refused ────────────────────────────────────
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(121, 0, 0, 0), 'Minutes played must be between',
  'MS4: more than 120 minutes refused by the RPC');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(90, 0, 21, 0), 'Assists must be between',
  'MS5: more than 20 assists refused by the RPC');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(0, 1, 0, 3), 'no minutes cannot have goals',
  'MS6: a player with no minutes cannot have scored');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(90, 3, 0, 2), 'cannot score more than the team',
  'MS7: a player cannot score more than the team did');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log(20, 12, 0, 12), 'is not possible',
  'MS8: 12 contributions in 20 minutes refused by the RPC');


-- ── 3. Ordinary football is NOT refused ──────────────────────
-- Without these the suite would pass just as well if the RPC refused
-- everything, which is the failure mode a denial-only suite cannot see.
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log(90, 2, 1, 3, 'MS-BRACE'),
  'MS9: a striker with a brace and an assist is accepted');
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log(0, 0, 0, 2, 'MS-UNUSED-SUB'),
  'MS10: an unused substitute is accepted');
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log(120, 1, 0, 2, 'MS-EXTRA-TIME'),
  'MS11: extra time is accepted');

-- The contribution floor. `goals + assists <= minutes / 5` alone refuses both
-- of these, and both are ordinary football — a five-minute substitute who
-- scores twice, and an 89th-minute substitute who scores at once. This is the
-- regression the floor exists to prevent, asserted rather than commented.
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log(5, 2, 0, 2, 'MS-FIVE-MINUTES'),
  'MS12: a 5-minute substitute who scores twice is accepted (floor)');
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log(1, 1, 0, 1, 'MS-LATE-SUB'),
  'MS13: an 89th-minute substitute who scores at once is accepted (floor)');


-- ── 4. The constraint is a second barrier, not the same one ──
-- The RPC is SECURITY DEFINER, so its checks run as the owner. A direct write
-- that bypasses the RPC must still be refused by the table itself.
RESET ROLE;
SELECT pg_temp.ms_expect_refused(
  format('INSERT INTO public.matches (user_id, opponent, position, competition, venue, age_group, goals, assists, minutes_played, match_date) VALUES (%L::uuid, %L, %L, %L, %L, %L, 999, 0, 90, CURRENT_DATE)',
         '96000000-0000-0000-0000-000000000002', 'MS-DIRECT', 'ST', 'League', 'Home', 'U12'),
  'MS14: a direct INSERT of 999 goals is refused by the table, not only the RPC');


-- ── 4b. A match's rows must add up (TRAK-149) ────────────────
-- There is no match row: each player is saved on their own. Before TRAK-149
-- every row was checked alone, so two one-goal scorers in a 1-0 were two
-- individually legal rows, and players from one match could carry different
-- scores. Same coach + date + opponent (case and spaces ignored) is one match.
CREATE FUNCTION pg_temp.ms_log_for(player integer, goals integer, team_score integer,
                                   opponent_score integer, opponent text, days_ago integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $test$
  SELECT format(
    'SELECT public.log_match_for_player(%L::uuid, %L, %s, %s, %L, %L, %L, %L, 90, %s, 0, %L, %L, %L, 6.5, current_date - %s)',
    '96000000-0000-0000-0000-' || lpad(player::text, 12, '0'), opponent, team_score, opponent_score,
    'League', 'Home', 'ST', 'U12', goals, 'None', 'Fresh', 'Good', days_ago);
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"96000000-0000-0000-0000-000000000001"}', true);
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log_for(2, 1, 1, 0, 'MS-One-Nil', 7),
  'MS18: 1-0, the first scorer is stored');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log_for(3, 1, 1, 0, '  ms-one-nil ', 7),
  '2 goals entered, but the team scored 1',
  'MS19: a second scorer in a 1-0 is refused, whatever the opponent''s case or spacing');
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log_for(3, 0, 1, 0, 'MS-ONE-NIL', 7),
  'MS20: a player who did not score is still accepted in the 1-0');
SELECT pg_temp.ms_expect_rpc_refusal(pg_temp.ms_log_for(4, 0, 2, 0, 'MS-ONE-NIL', 7),
  'already saved as 1-0',
  'MS21: a player saved with a different score for the same match is refused');
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log_for(2, 1, 2, 0, 'MS-TWO-NIL', 7),
  'MS22: 2-0, the first scorer is stored');
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log_for(3, 1, 2, 0, 'MS-TWO-NIL', 7),
  'MS23: 2-0, the second scorer is stored too');
SELECT pg_temp.ms_expect_ok(pg_temp.ms_log_for(4, 1, 1, 0, 'MS-ONE-NIL', 6),
  'MS24: the same opponent on another day is a separate match');
RESET ROLE;
SELECT pg_temp.ms_assert(
  (SELECT count(*) = 2 AND sum(goals) = 1 FROM public.matches
    WHERE logged_by = pg_temp.ms_id(1) AND match_date = current_date - 7
      AND lower(btrim(opponent)) = 'ms-one-nil'),
  'MS25: readback, the 1-0 holds two players and one goal; the refused rows were never stored');


-- ── 5. What this migration must not have broken ──────────────
SELECT pg_temp.ms_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'log_match_for_player') LIKE '%squad_player_is_mine%',
  'MS15: the departure check from 20260917000005 survives the replacement');
SELECT pg_temp.ms_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'log_match_for_player') LIKE '%is_coach%',
  'MS16: the coach check survives the replacement');
SELECT pg_temp.ms_assert(
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass AND contype = 'c'
      AND conname LIKE 'matches_%') >= 6,
  'MS17: all six new CHECK constraints exist');


-- ── Verdict ─────────────────────────────────────────────────
DO $test$
DECLARE failed integer; details text;
BEGIN
  SELECT count(*), string_agg(description || coalesce(' [' || detail || ']', ''), E'\n' ORDER BY description)
  INTO failed, details FROM pg_temp.ms_results WHERE NOT passed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Match stat rules: % failing assertions', failed USING DETAIL = details;
  END IF;
  IF (SELECT count(*) FROM pg_temp.ms_results) <> 25 THEN
    RAISE EXCEPTION 'Match stat rules: % assertions ran; expected exactly 25', (SELECT count(*) FROM pg_temp.ms_results);
  END IF;
END;
$test$;
SELECT count(*) AS match_stat_assertions FROM pg_temp.ms_results;
ROLLBACK;

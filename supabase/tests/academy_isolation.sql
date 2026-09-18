-- @trak-suite mode=--academy-isolation-review in-all=true
-- U7 and U8 — the destructive half, against a disposable database.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- U7's read direction was run against the live project: a Rehearsal FC coach
-- asking for City FC by organization id got zero rows on every table, with a
-- working control. The write direction could not be run there — a correct
-- refusal is fine, but a success would leave a permanent bad row in the
-- database the pilot demos from. This is that half, where a success is thrown
-- away with the transaction.
--
-- U8 is the same question after a coach leaves: K2 and F2-F5 say a departed
-- coach keeps nothing. Asserted here rather than assumed.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing isolation fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.aid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE iso_results (description text, passed boolean, detail text);
GRANT INSERT ON iso_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.iassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.iso_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

-- Expects refusal. A success raises, which also rolls the write back, so a
-- vulnerable build reports instead of contaminating later assertions. The
-- sentinel is matched on its message: a custom ERRCODE lands in WHEN OTHERS
-- and an earlier version of this helper counted that as "denied", which made
-- every assertion unfalsifiable.
CREATE FUNCTION pg_temp.idenied(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE denied boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'trak-unexpectedly-allowed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'trak-unexpectedly-allowed' THEN
        denied := false; failure := 'WRITE SUCCEEDED';
      ELSE
        denied := true; failure := SQLSTATE;
      END IF;
  END;
  INSERT INTO pg_temp.iso_results VALUES (description, denied, failure);
END;
$test$;

-- UPDATE and DELETE do not error when RLS filters every candidate row away —
-- they report success having changed nothing. So the question "was it denied?"
-- cannot be answered from the statement's exit status.
--
-- Nor can it be answered by reading the row back as the attacker: they cannot
-- see academy A's rows at all, so the probe returns NULL whether the write
-- landed or not. Both mistakes were made here before this comment existed; the
-- first reported correct isolation as four breaches, the second as four more.
--
-- attempt() only records that the statement ran. The verification happens
-- afterwards, from a role that can actually see the row.
CREATE FUNCTION pg_temp.iattempt(statement text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  EXECUTE statement;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$test$;

CREATE FUNCTION pg_temp.iactor(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

-- ── Two academies, mirroring City FC and Rehearsal FC ───────────────────────

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.aid(1),  'adminA@iso.test', now()),
  (pg_temp.aid(2),  'adminB@iso.test', now()),
  (pg_temp.aid(10), 'coachA@iso.test', now()),
  (pg_temp.aid(11), 'coachB@iso.test', now()),
  (pg_temp.aid(12), 'departed@iso.test', now()),
  (pg_temp.aid(20), 'childA@iso.test', now());

INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.aid(100), pg_temp.aid(1), 'Academy A', 'ISOAA1'),
  (pg_temp.aid(101), pg_temp.aid(2), 'Academy B', 'ISOBB1');

INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.aid(10), 'coach',  'Coach A',        'ISOCA'),
  (pg_temp.aid(11), 'coach',  'Coach B',        'ISOCB'),
  (pg_temp.aid(12), 'coach',  'Departed Coach', 'ISOCD'),
  (pg_temp.aid(20), 'player', 'Child A',        NULL);

INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.aid(10), pg_temp.aid(100)),
  (pg_temp.aid(11), pg_temp.aid(101)),
  (pg_temp.aid(12), pg_temp.aid(100));

INSERT INTO public.player_details (user_id, date_of_birth)
VALUES (pg_temp.aid(20), '2004-01-01');

-- Academy A's roster row, and one belonging to the coach who will depart.
INSERT INTO public.squad_players (id, coach_user_id, player_name, organization_id, status, linked_player_id)
VALUES
  (pg_temp.aid(200), pg_temp.aid(10), 'Child A', pg_temp.aid(100), 'active', pg_temp.aid(20)),
  (pg_temp.aid(201), pg_temp.aid(12), 'Departing Squad Player', pg_temp.aid(100), 'active', NULL);

INSERT INTO public.coach_assessments
  (id, coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability, organization_id)
VALUES (pg_temp.aid(300), pg_temp.aid(10), pg_temp.aid(200), 7,7,7,7,7,7, pg_temp.aid(100));

-- ── Positive control, before any denial is claimed ──────────────────────────
--
-- Every assertion below is "this write was refused". All of them would also
-- pass if auth.uid() were simply NULL and nothing matched anything — which is
-- the failure mode that makes a security suite look strongest exactly when it
-- is testing nothing. Coach A updating their OWN assessment must succeed
-- first; if it does not, none of the denials below mean what they say.

SET LOCAL ROLE authenticated;
SELECT pg_temp.iactor(pg_temp.aid(10));

DO $test$
DECLARE v_after integer;
BEGIN
  UPDATE public.coach_assessments SET work_rate = 8 WHERE id = pg_temp.aid(300);
  SELECT work_rate INTO v_after FROM public.coach_assessments WHERE id = pg_temp.aid(300);
  PERFORM pg_temp.iassert(v_after = 8,
    'POSITIVE CONTROL: coach A can update their own assessment',
    'work_rate is ' || coalesce(v_after::text, 'not visible'));
  -- Put it back so the denial checks below have a known value.
  UPDATE public.coach_assessments SET work_rate = 7 WHERE id = pg_temp.aid(300);
END;
$test$;

-- ── U7, write direction: Coach B reaching into Academy A ────────────────────

SELECT pg_temp.iactor(pg_temp.aid(11));

SELECT pg_temp.idenied(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability) VALUES (%L, %L, 9,9,9,9,9,9)',
  pg_temp.aid(11), pg_temp.aid(200)),
  'U7w a coach from academy B cannot assess academy A''s player');

SELECT pg_temp.iattempt(format('UPDATE public.coach_assessments SET work_rate = 1 WHERE id = %L', pg_temp.aid(300)));
SELECT pg_temp.iattempt(format('DELETE FROM public.coach_assessments WHERE id = %L', pg_temp.aid(300)));
SELECT pg_temp.iattempt(format('UPDATE public.squad_players SET player_name = ''Renamed'' WHERE id = %L', pg_temp.aid(200)));

-- The X2 signature: claiming another academy's child by asserting their id.
SELECT pg_temp.idenied(format(
  'INSERT INTO public.squad_players (coach_user_id, player_name, organization_id, linked_player_id, status) VALUES (%L, ''Stolen'', %L, %L, ''active'')',
  pg_temp.aid(11), pg_temp.aid(100), pg_temp.aid(20)),
  'U7w a coach cannot create a roster row inside another academy');

SELECT pg_temp.idenied(format(
  'SELECT public.log_match_for_player(%L, ''Opponent'', 1, 0, ''League'', ''Home'', ''Midfielder'', ''U17'', 90, 0, 0, NULL, NULL, NULL, 7.0, CURRENT_DATE)',
  pg_temp.aid(20)),
  'U7w a coach from academy B cannot log a match for academy A''s child');

-- Read control, so a blanket failure cannot be mistaken for isolation.
DO $test$
DECLARE v_own integer;
BEGIN
  SELECT count(*) INTO v_own FROM public.squad_players WHERE coach_user_id = pg_temp.aid(11);
  PERFORM pg_temp.iassert(v_own = 0, 'control: coach B has no roster rows of their own yet', v_own || ' row(s)');
END;
$test$;

-- ── U8: the coach who has left ──────────────────────────────────────────────

RESET ROLE;
-- remove_coach_from_org is how a departure actually happens.
DO $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role','service_role')::text, true);
  BEGIN
    PERFORM public.remove_coach_from_org(pg_temp.aid(12));
  EXCEPTION WHEN OTHERS THEN
    -- If the RPC is not callable this way, fall back to the state it produces
    -- so the access assertions below are still meaningful.
    UPDATE public.squad_players SET status = 'coach_departed' WHERE coach_user_id = pg_temp.aid(12);
    UPDATE public.coach_details SET organization_id = NULL WHERE user_id = pg_temp.aid(12);
  END;
END;
$test$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.iactor(pg_temp.aid(12));

DO $test$
DECLARE v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM public.squad_players WHERE id = pg_temp.aid(201);
  PERFORM pg_temp.iassert(v_rows = 0,
    'U8 a departed coach reads none of their former roster', v_rows || ' row(s) visible');
END;
$test$;

SELECT pg_temp.idenied(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability) VALUES (%L, %L, 5,5,5,5,5,5)',
  pg_temp.aid(12), pg_temp.aid(201)),
  'U8 a departed coach cannot assess their former player');

SELECT pg_temp.iattempt(format('UPDATE public.squad_players SET player_name = ''Still mine'' WHERE id = %L', pg_temp.aid(201)));

-- publish_player_feedback belongs to the unmerged T2 migration, so asserting it
-- here would pass as undefined_function and prove nothing. It is covered by
-- feedback_publication.sql on that branch instead.

RESET ROLE;

-- ── Verification, from a role that can see the rows ─────────────────────────
--
-- Every attempted write above is now checked against the data itself. This is
-- the only place the question "did anything actually change?" can be answered.

DO $test$
DECLARE v_work integer; v_count integer; v_nameA text; v_nameD text;
BEGIN
  SELECT work_rate INTO v_work FROM public.coach_assessments WHERE id = pg_temp.aid(300);
  PERFORM pg_temp.iassert(v_work = 7,
    'U7w a coach from academy B cannot alter academy A''s assessment',
    'work_rate is ' || coalesce(v_work::text, 'row gone'));

  SELECT count(*) INTO v_count FROM public.coach_assessments WHERE id = pg_temp.aid(300);
  PERFORM pg_temp.iassert(v_count = 1,
    'U7w a coach from academy B cannot delete academy A''s assessment',
    v_count || ' row(s) remain');

  SELECT player_name INTO v_nameA FROM public.squad_players WHERE id = pg_temp.aid(200);
  PERFORM pg_temp.iassert(v_nameA = 'Child A',
    'U7w a coach from academy B cannot rename academy A''s roster row',
    'name is ' || coalesce(v_nameA, 'NULL'));

  SELECT player_name INTO v_nameD FROM public.squad_players WHERE id = pg_temp.aid(201);
  PERFORM pg_temp.iassert(v_nameD = 'Departing Squad Player',
    'U8 a departed coach cannot edit their former roster row',
    'name is ' || coalesce(v_nameD, 'NULL'));
END;
$test$;

-- ── Report ─────────────────────────────────────────────────────────────────

DO $test$
DECLARE failed integer; total integer; r record;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.iso_results;
  FOR r IN SELECT * FROM pg_temp.iso_results WHERE NOT passed LOOP
    RAISE WARNING 'FAILED: % — %', r.description, coalesce(r.detail, '');
  END LOOP;
  RAISE NOTICE 'Academy isolation assertions: % of % passed', total - failed, total;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Academy isolation: % of % desired assertions failed', failed, total;
  END IF;
END;
$test$;

ROLLBACK;

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
      ELSIF SQLSTATE IN ('42501', 'P0001') THEN
        -- 42501 is RLS or a privilege refusal; P0001 is a RAISE in our own
        -- code. Anything else means the statement failed for an unrelated
        -- reason and the assertion proved nothing. This branch used to accept
        -- every SQLSTATE, so an undefined column or a constraint violation
        -- read as isolation — the same trap the consent suite was corrected
        -- for, left uncorrected here.
        --
        -- The SQLSTATE alone does not say WHICH refusal: 42501 covers both
        -- "no grant on this table" and "RLS rejected this row". Those are very
        -- different claims — the first would still refuse if every policy were
        -- deleted — so the message is recorded alongside it and the
        -- isolation assertions below assert on it. Kostas's suggestion.
        denied := true;
        failure := SQLSTATE || ': ' || left(SQLERRM, 80);
      ELSE
        denied := false;
        failure := 'NOT A DENIAL — ' || SQLSTATE || ': ' || left(SQLERRM, 60);
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

-- Isolation is a claim about ROW-LEVEL SECURITY, not about a missing grant.
-- idenied accepts either, because 42501 covers both. Where the claim is
-- specifically "the policy rejected this row", assert that: a suite that would
-- still pass with every policy dropped is not testing isolation.
CREATE FUNCTION pg_temp.idenied_by_rls(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE passed boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'trak-unexpectedly-allowed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'trak-unexpectedly-allowed' THEN
        failure := 'WRITE SUCCEEDED';
      ELSIF SQLSTATE = '42501' AND SQLERRM ILIKE '%row-level security%' THEN
        passed := true; failure := 'RLS';
      ELSIF SQLSTATE = '42501' THEN
        failure := 'REFUSED, BUT NOT BY RLS — ' || left(SQLERRM, 70);
      ELSE
        failure := 'NOT A DENIAL — ' || SQLSTATE || ': ' || left(SQLERRM, 60);
      END IF;
  END;
  INSERT INTO pg_temp.iso_results VALUES (description, passed, failure);
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
  (pg_temp.aid(1),  'club',   'Admin A',        NULL),
  (pg_temp.aid(2),  'club',   'Admin B',        NULL),
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

-- WHICH clause refuses this, and which only look like they do.
--
-- I could not reconcile two observations: a standalone probe showed that
-- neutralising squad_player_is_mine() let coach B write against academy A's
-- child, while this suite stayed green through that mutation and through the
-- organization_id one and through both together. Kostas took it and found the
-- answer, and it is in his code rather than this suite:
--
--   20260917000001 installs a BEFORE INSERT trigger that derives
--   organization_id FROM THE ROW'S COACH. The policy then compares it against
--   that same coach's organisation, because coach_user_id = auth.uid() is
--   enforced two clauses above. On INSERT the two sides are equal by
--   construction, so that clause is tautologically true.
--
-- So for this attack the WITH CHECK is one load-bearing clause —
-- squad_player_is_mine() — plus five that cannot fail. It reads as layered
-- defence and is not. Keep the org clause: the trigger is BEFORE INSERT only,
-- so on UPDATE it can genuinely fail.
--
-- This is not a live defect and isolation is not broken: squad_player_is_mine
-- is intact, the refusal below is real, and U7's read direction was verified
-- against two real academies in the live database. What changed is what this
-- suite entitles anyone to claim.
--
-- Asserted through idenied_by_rls so the refusal must come from the POLICY.
-- The old assertion accepted any 42501, which a missing grant also produces —
-- and a missing grant would still refuse with every policy deleted.
SELECT pg_temp.idenied_by_rls(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability) VALUES (%L, %L, 9,9,9,9,9,9)',
  pg_temp.aid(11), pg_temp.aid(200)),
  'U7w a coach from academy B cannot assess academy A''s player (refused by RLS, not by a missing grant)');

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
-- Real trusted departure with a complete owning-admin identity. Do not fall
-- back to hand-written state: a broken incident RPC must fail this fixture.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role','service_role','sub',pg_temp.aid(1))::text, true);
SELECT public.remove_coach_from_org(pg_temp.aid(12));
SELECT pg_temp.iassert(
  (SELECT organization_id IS NULL FROM public.coach_details WHERE user_id = pg_temp.aid(12)),
  'U8 fixture: trusted removal clears the target membership');
SELECT pg_temp.iassert(
  (SELECT status = 'coach_departed' FROM public.squad_players WHERE id = pg_temp.aid(201)),
  'U8 fixture: trusted removal marks the target roster departed');
RESET ROLE;

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

-- @trak-suite mode=--roster-adoption-review in-all=false
-- T4 — does a player joining with a TRK code actually keep the assessments the
-- coach already recorded against them?
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- link_player_to_coach() adopts the coach's existing roster row only when the
-- player's profile name matches exactly one unlinked row, case-insensitively.
-- Anything else falls through to INSERT a fresh row. This suite asks what
-- happens in the cases a real academy produces: an exact match, a misspelling,
-- and two players with the same name.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing roster adoption fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.rid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('95000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE roster_results (description text, passed boolean, detail text);

CREATE FUNCTION pg_temp.rassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.roster_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

CREATE FUNCTION pg_temp.become(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
END;
$test$;

-- ── Fixture: one coach, one academy, three roster rows ──────────────────────

INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES
  (pg_temp.rid(2),  'admin@adoption.test',  now()),
  (pg_temp.rid(10), 'coach@adoption.test',  now()),
  (pg_temp.rid(20), 'yusuf@adoption.test',  now()),
  (pg_temp.rid(21), 'mo@adoption.test',     now()),
  (pg_temp.rid(22), 'ali@adoption.test',    now());

INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.rid(1), pg_temp.rid(2), 'Adoption FC', 'ADOPT1');

INSERT INTO public.profiles (user_id, role, full_name, invite_code)
VALUES
  (pg_temp.rid(10), 'coach',  'Adoption Coach',   'ADOPTC'),
  -- Exactly matches the roster row the coach typed.
  (pg_temp.rid(20), 'player', 'Yusuf Al Marzouqi', NULL),
  -- The coach typed "Mohammad"; the player registered as "Mohammed".
  (pg_temp.rid(21), 'player', 'Mohammed Hassan',   NULL),
  -- Two roster rows share this name.
  (pg_temp.rid(22), 'player', 'Ali Khan',          NULL);

INSERT INTO public.coach_details (user_id, organization_id)
VALUES (pg_temp.rid(10), pg_temp.rid(1));

INSERT INTO public.squad_players (id, coach_user_id, player_name, organization_id, status)
VALUES
  (pg_temp.rid(30), pg_temp.rid(10), 'Yusuf Al Marzouqi', pg_temp.rid(1), 'active'),
  (pg_temp.rid(31), pg_temp.rid(10), 'Mohammad Hassan',   pg_temp.rid(1), 'active'),
  (pg_temp.rid(32), pg_temp.rid(10), 'Ali Khan',          pg_temp.rid(1), 'active'),
  (pg_temp.rid(33), pg_temp.rid(10), 'Ali Khan',          pg_temp.rid(1), 'active');

-- Two prior assessments against each roster row, as the task specifies.
INSERT INTO public.coach_assessments
  (id, coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability, organization_id)
SELECT pg_temp.rid(40 + n), pg_temp.rid(10), sp, 7, 7, 7, 7, 7, 7, pg_temp.rid(1)
FROM (VALUES (1, pg_temp.rid(30)), (2, pg_temp.rid(30)),
             (3, pg_temp.rid(31)), (4, pg_temp.rid(31))) AS t(n, sp);

-- ── 1. Exact name: the row is adopted and its history comes with it ─────────

DO $test$
DECLARE v_sq uuid; v_count integer; v_rows integer;
BEGIN
  PERFORM pg_temp.become(pg_temp.rid(20));
  v_sq := public.link_player_to_coach('ADOPTC');

  PERFORM pg_temp.rassert(v_sq = pg_temp.rid(30),
    'exact name adopts the coach''s existing roster row',
    'returned ' || coalesce(v_sq::text, 'null'));

  SELECT count(*) INTO v_count FROM public.coach_assessments WHERE squad_player_id = v_sq;
  PERFORM pg_temp.rassert(v_count = 2,
    'adopted row keeps both prior assessments',
    v_count || ' assessment(s) visible on the linked row');

  SELECT count(*) INTO v_rows FROM public.squad_players
  WHERE coach_user_id = pg_temp.rid(10) AND linked_player_id = pg_temp.rid(20);
  PERFORM pg_temp.rassert(v_rows = 1, 'no duplicate roster row was created', v_rows || ' row(s)');
END;
$test$;

-- ── 2. Misspelling: what actually happens to the player's history ───────────
--
-- The coach typed "Mohammad", the player registered "Mohammed". Tarek found on
-- a real phone that coaches type names freehand and misspell them. This is the
-- assertion that matters for Gate 1: the player must not silently lose two
-- assessments because of one letter.

DO $test$
DECLARE v_sq uuid; v_count integer; v_orphan integer;
BEGIN
  PERFORM pg_temp.become(pg_temp.rid(21));
  v_sq := public.link_player_to_coach('ADOPTC');

  SELECT count(*) INTO v_count FROM public.coach_assessments WHERE squad_player_id = v_sq;
  PERFORM pg_temp.rassert(v_count = 2,
    'a one-letter misspelling still keeps the player''s assessments',
    v_count || ' assessment(s) on the row the player actually landed on');

  -- The coach's original row, still carrying the history, now linked to nobody.
  SELECT count(*) INTO v_orphan
  FROM public.squad_players
  WHERE id = pg_temp.rid(31) AND linked_player_id IS NULL;
  PERFORM pg_temp.rassert(v_orphan = 0,
    'the coach''s original row is not left orphaned with the history on it',
    v_orphan || ' orphaned row(s) still holding assessments');
END;
$test$;

-- ── 3. Two players with the same name ───────────────────────────────────────
--
-- Ordinary in an academy. Adoption requires exactly one match, so this falls
-- through — the question is whether it does so safely or silently.

DO $test$
DECLARE v_sq uuid; v_unlinked integer;
BEGIN
  PERFORM pg_temp.become(pg_temp.rid(22));
  v_sq := public.link_player_to_coach('ADOPTC');

  SELECT count(*) INTO v_unlinked
  FROM public.squad_players
  WHERE coach_user_id = pg_temp.rid(10)
    AND player_name = 'Ali Khan'
    AND linked_player_id IS NULL;

  PERFORM pg_temp.rassert(v_unlinked <= 1,
    'an ambiguous name does not leave two unlinked rows plus a third new one',
    v_unlinked || ' unlinked "Ali Khan" row(s) remain');
END;
$test$;

-- ── 4. my_link_outcome reports what actually happened ──────────────────────
--
-- The fix for the misspelling case is not a cleverer guess — it is that the
-- player is told. Paired assertions, because a suite made only of "this said
-- nothing" also passes when the function is broken and returns nothing.

DO $test$
DECLARE v_mo jsonb; v_yu jsonb; v_sq uuid;
BEGIN
  -- The misspelt player: landed on a fresh row, coach still holds unclaimed
  -- rows carrying the history. Must be told something may be missing.
  PERFORM pg_temp.become(pg_temp.rid(21));
  SELECT id INTO v_sq FROM public.squad_players WHERE linked_player_id = pg_temp.rid(21);
  v_mo := public.my_link_outcome(v_sq);
  PERFORM pg_temp.rassert((v_mo->>'may_have_missed_history')::boolean IS TRUE,
    'the misspelt player is warned that history may be missing',
    coalesce(v_mo::text, 'null'));

  -- POSITIVE CONTROL: the player who adopted cleanly must NOT be warned.
  -- Without this, a function that always returns true would pass above.
  PERFORM pg_temp.become(pg_temp.rid(20));
  SELECT id INTO v_sq FROM public.squad_players WHERE linked_player_id = pg_temp.rid(20);
  v_yu := public.my_link_outcome(v_sq);
  PERFORM pg_temp.rassert((v_yu->>'may_have_missed_history')::boolean IS FALSE,
    'CONTROL: the player who adopted cleanly is not warned',
    coalesce(v_yu::text, 'null'));

  PERFORM pg_temp.rassert((v_yu->>'assessments')::integer = 2,
    'CONTROL: the adopted player is reported as having their assessments',
    coalesce(v_yu->>'assessments', 'null'));
END;
$test$;

-- ── Report ─────────────────────────────────────────────────────────────────

DO $test$
DECLARE failed integer; total integer; r record;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.roster_results;
  FOR r IN SELECT * FROM pg_temp.roster_results WHERE NOT passed LOOP
    RAISE WARNING 'FAILED: % — %', r.description, coalesce(r.detail, '');
  END LOOP;
  RAISE NOTICE 'Roster adoption assertions: % of % passed', total - failed, total;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Roster adoption: % of % desired assertions failed', failed, total;
  END IF;
END;
$test$;

ROLLBACK;

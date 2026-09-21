-- @trak-suite mode=--player-journey-review in-all=false
-- Gate 1, boxes 3, 4 and 10 — the whole loop, end to end, as roles.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- "An academy coach signs up, registers their players, assesses them, the
-- players are in their account, they receive their feedback." That sentence is
-- the pilot. Nothing had ever run it in one pass, so this does: coach signs up
-- with an academy code, adds a player, assesses them twice, the player joins
-- with the TRK code, the coach publishes feedback, the player reads it.
--
-- Each step asserts what the player should be able to see afterwards, because
-- the failure mode that matters here is not an error — it is a screen that is
-- quietly empty.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing journey fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.jid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE journey_results (description text, passed boolean, detail text);
GRANT INSERT ON journey_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.jassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.journey_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

CREATE FUNCTION pg_temp.jactor(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

-- The academy exists, as it would after a club signs up.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.jid(1),  'admin@journey.test', now()),
  (pg_temp.jid(10), 'coach@journey.test', now()),
  (pg_temp.jid(20), 'player@journey.test', now());

INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.jid(100), pg_temp.jid(1), 'Journey FC', 'JRNY01');

-- ── 1. The coach signs up, giving the academy's join code ───────────────────

SET LOCAL ROLE authenticated;
SELECT pg_temp.jactor(pg_temp.jid(10));

DO $test$
DECLARE v_org uuid; v_code text;
BEGIN
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'coach',
    'full_name', 'Journey Coach',
    'coach_details', jsonb_build_object('academy_code', 'JRNY01', 'current_club', 'Journey FC')
  ));

  SELECT organization_id INTO v_org FROM public.coach_details WHERE user_id = pg_temp.jid(10);
  PERFORM pg_temp.jassert(v_org = pg_temp.jid(100),
    '1 a coach who gives the academy code is linked to that academy',
    coalesce(v_org::text, 'NULL — invisible to the academy'));

  SELECT invite_code INTO v_code FROM public.profiles WHERE user_id = pg_temp.jid(10);
  PERFORM pg_temp.jassert(coalesce(v_code, '') <> '',
    '1 the coach gets a TRK code for players to join with', coalesce(v_code, 'none'));
  -- Captured here, as the coach, because a player cannot read the coach's
  -- profile row — correctly. In the real flow the coach tells them the code.
  PERFORM set_config('trak.journey_code', v_code, true);
END;
$test$;

-- ── 2. The coach registers a player and assesses them twice ─────────────────

DO $test$
DECLARE v_sp uuid; v_org uuid;
BEGIN
  INSERT INTO public.squad_players (coach_user_id, player_name, status)
  VALUES (pg_temp.jid(10), 'Journey Player', 'active')
  RETURNING id INTO v_sp;

  PERFORM set_config('trak.journey_squad_player', v_sp::text, true);

  SELECT organization_id INTO v_org FROM public.squad_players WHERE id = v_sp;
  PERFORM pg_temp.jassert(v_org = pg_temp.jid(100),
    '2 the roster row is stamped with the coach''s academy',
    coalesce(v_org::text, 'NULL — the academy cannot see this player'));

  INSERT INTO public.coach_assessments
    (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
  VALUES
    (pg_temp.jid(10), v_sp, 6,6,6,6,6,6),
    (pg_temp.jid(10), v_sp, 8,8,8,8,8,8);

  PERFORM pg_temp.jassert(
    (SELECT count(*) FROM public.coach_assessments WHERE squad_player_id = v_sp) = 2,
    '2 both assessments are recorded against the roster row');
END;
$test$;

-- ── 3. The player signs up and joins with the coach's code ──────────────────

SELECT pg_temp.jactor(pg_temp.jid(20));

DO $test$
DECLARE v_code text; v_sq uuid; v_seen integer;
BEGIN
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'player',
    'full_name', 'Journey Player',
    'player_details', jsonb_build_object('date_of_birth', '2004-05-05', 'position', 'Midfielder')
  ));

  v_code := current_setting('trak.journey_code', true);
  v_sq := public.link_player_to_coach(v_code);

  PERFORM pg_temp.jassert(v_sq = current_setting('trak.journey_squad_player')::uuid,
    '3 the player joins the roster row the coach already created',
    'landed on ' || coalesce(v_sq::text, 'null'));

  -- The box: "keeps the assessments the coach already recorded for them".
  SELECT count(*) INTO v_seen FROM public.coach_assessments WHERE squad_player_id = v_sq;
  PERFORM pg_temp.jassert(v_seen = 2,
    '3 the player keeps both assessments the coach recorded before they joined',
    v_seen || ' assessment(s) on their row');

  PERFORM pg_temp.jassert(
    (SELECT count(*) FROM public.squad_players WHERE linked_player_id = pg_temp.jid(20)) = 1,
    '3 joining does not create a second roster row');
END;
$test$;

-- What the player can actually read once linked.
DO $test$
DECLARE v_assessments integer;
BEGIN
  SELECT count(*) INTO v_assessments FROM public.coach_assessments;
  PERFORM pg_temp.jassert(v_assessments = 2,
    '4 the player can read their own assessments', v_assessments || ' visible to them');
END;
$test$;

-- ── 4. The coach publishes feedback; only then can the player read it ───────

SELECT pg_temp.jactor(pg_temp.jid(10));

DO $test$
DECLARE v_sp uuid := current_setting('trak.journey_squad_player')::uuid;
BEGIN
  PERFORM public.publish_player_feedback(v_sp, 'Your first touch has come on a lot. Keep going.', NULL);
  PERFORM pg_temp.jassert(true, '5 the coach publishes approved feedback');
END;
$test$;

SELECT pg_temp.jactor(pg_temp.jid(20));

DO $test$
DECLARE v_text text; v_drafts integer;
BEGIN
  SELECT published_text INTO v_text FROM public.player_feedback WHERE superseded_at IS NULL;
  PERFORM pg_temp.jassert(v_text LIKE 'Your first touch%',
    '5 the player reads the feedback their coach approved',
    coalesce(left(v_text, 30), 'nothing readable'));

  SELECT count(*) INTO v_drafts FROM public.ai_feedback_drafts;
  PERFORM pg_temp.jassert(v_drafts = 0,
    '6 the player still cannot read any unapproved draft', v_drafts || ' visible');
END;
$test$;

-- ── 5. The same journey for a coach who signs up without an academy code ────
--
-- This is the path Tarek took on a real phone: sign up as a coach, no academy
-- code to hand, because the academy has not given you one yet. The signup RPC
-- treats a missing code as non-fatal and leaves organization_id NULL.
--
-- The consequences are the two assertions below, and they are the ones that
-- matter for "the academy account sees its coaches and squads".

RESET ROLE;
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES (pg_temp.jid(11), 'nocode@journey.test', now());

SET LOCAL ROLE authenticated;
SELECT pg_temp.jactor(pg_temp.jid(11));

DO $test$
DECLARE v_org uuid; v_sp uuid; v_sp_org uuid;
BEGIN
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'coach',
    'full_name', 'Codeless Coach',
    'coach_details', jsonb_build_object('current_club', 'Journey FC')
  ));

  SELECT organization_id INTO v_org FROM public.coach_details WHERE user_id = pg_temp.jid(11);
  PERFORM pg_temp.jassert(v_org IS NOT NULL,
    '7 a coach who signs up without an academy code still ends up in an academy',
    coalesce(v_org::text, 'NULL — the academy dashboard cannot see this coach'));

  INSERT INTO public.squad_players (coach_user_id, player_name, status)
  VALUES (pg_temp.jid(11), 'Unstamped Player', 'active')
  RETURNING id INTO v_sp;

  SELECT organization_id INTO v_sp_org FROM public.squad_players WHERE id = v_sp;
  PERFORM pg_temp.jassert(v_sp_org IS NOT NULL,
    '7 players added by that coach are stamped with an academy',
    coalesce(v_sp_org::text, 'NULL — every row this coach creates is unstamped'));
END;
$test$;

RESET ROLE;

-- ── Report ─────────────────────────────────────────────────────────────────

DO $test$
DECLARE failed integer; total integer; r record;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.journey_results;
  FOR r IN SELECT * FROM pg_temp.journey_results WHERE NOT passed LOOP
    RAISE WARNING 'FAILED: % — %', r.description, coalesce(r.detail, '');
  END LOOP;
  RAISE NOTICE 'Player journey assertions: % of % passed', total - failed, total;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Player journey: % of % desired assertions failed', failed, total;
  END IF;
END;
$test$;

ROLLBACK;

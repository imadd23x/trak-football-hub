-- @trak-suite mode=--pilot-j7-review in-all=true
-- ============================================================
-- J7 (TRAK-10): assessments per coach this week, and player and parent opens
-- this week, from real UI events only (20260926130000).
--
-- Every number the report must NOT count has a decoy here, next to a real
-- event that must count, so each exclusion can fail:
--   * the same assessment saved twice, and a parent/child opening repeatedly;
--   * events naming a missing, malformed or someone else's assessment;
--   * a child forging a coach's save event;
--   * opens of an unpublished message, of another child's message, and by a
--     parent who is not linked;
--   * a synthetic (Rehearsal FC) coach inside the pilot academy;
--   * a real coach in another academy;
--   * last week's work.
-- The pilot coach who did nothing must still appear, with 0.
-- ============================================================
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing J7 fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.jid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('07000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Assertion failed: %', description;
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.metric(m text, who uuid DEFAULT NULL) RETURNS bigint
LANGUAGE sql AS $test$
  SELECT value FROM public.pilot_j7_this_week
  WHERE metric = m AND coach_user_id IS NOT DISTINCT FROM who;
$test$;

-- ── Fixture ─────────────────────────────────────────────────
-- Real-looking domains for the people who must count; the synthetic coach is
-- on Rehearsal FC's domain.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.jid(1),  'alex.coach@j7academy.org',      now()),  -- pilot coach, busy
  (pg_temp.jid(2),  'zoe.coach@j7academy.org',       now()),  -- pilot coach, idle
  (pg_temp.jid(3),  'coach.u15@rehearsal.trak.dev',  now()),  -- synthetic, in the pilot academy
  (pg_temp.jid(4),  'ben.coach@otheracademy.org',    now()),  -- real, other academy
  (pg_temp.jid(11), 'child.one@j7family.org',        now()),
  (pg_temp.jid(12), 'child.two@j7family.org',        now()),
  (pg_temp.jid(21), 'parent.one@j7family.org',       now()),  -- linked to child one
  (pg_temp.jid(22), 'parent.stranger@j7family.org',  now()),  -- linked to nobody here
  (pg_temp.jid(31), 'admin@j7academy.org',           now());

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.jid(1),  'coach',  'Alex Coach'),
  (pg_temp.jid(2),  'coach',  'Zoe Coach'),
  (pg_temp.jid(3),  'coach',  'Rehearsal Coach'),
  (pg_temp.jid(4),  'coach',  'Ben Coach'),
  (pg_temp.jid(11), 'player', 'Child One'),
  (pg_temp.jid(12), 'player', 'Child Two'),
  (pg_temp.jid(21), 'parent', 'Parent One'),
  (pg_temp.jid(22), 'parent', 'Parent Stranger'),
  (pg_temp.jid(31), 'club',   'Admin');

INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.jid(101), pg_temp.jid(31), 'J7 Academy',    'J7-PILOT'),
  (pg_temp.jid(102), pg_temp.jid(31), 'Other Academy', 'J7-OTHER');

INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.jid(1), pg_temp.jid(101)),
  (pg_temp.jid(2), pg_temp.jid(101)),
  (pg_temp.jid(3), pg_temp.jid(101)),
  (pg_temp.jid(4), pg_temp.jid(102));

INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.jid(201), pg_temp.jid(1), 'Child One', pg_temp.jid(11)),
  (pg_temp.jid(202), pg_temp.jid(1), 'Child Two', pg_temp.jid(12)),
  (pg_temp.jid(203), pg_temp.jid(3), 'Rehearsal Child', NULL),
  (pg_temp.jid(204), pg_temp.jid(4), 'Other Child', NULL);

INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
VALUES (pg_temp.jid(11), pg_temp.jid(21));

INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id) VALUES
  (pg_temp.jid(301), pg_temp.jid(201), pg_temp.jid(1)),  -- child one, message published
  (pg_temp.jid(302), pg_temp.jid(202), pg_temp.jid(1)),  -- child two, message NOT published
  (pg_temp.jid(303), pg_temp.jid(201), pg_temp.jid(1)),  -- child one, saved last week
  (pg_temp.jid(304), pg_temp.jid(203), pg_temp.jid(3)),  -- the synthetic coach's
  (pg_temp.jid(305), pg_temp.jid(204), pg_temp.jid(4));  -- the other academy's

INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at) VALUES
  (pg_temp.jid(301), pg_temp.jid(1), 'Published words', now()),
  (pg_temp.jid(302), pg_temp.jid(1), 'Draft words', NULL);

UPDATE public.pilot_config
   SET org_id = pg_temp.jid(101), starts_on = current_date, weeks = 8, count_synthetic = false
 WHERE id;

-- ── Events, as the app would have written them ─────────────
INSERT INTO public.telemetry_events (user_id, role, event_type, metadata, created_at) VALUES
  -- Alex: two assessments this week, the first saved twice.
  (pg_temp.jid(1),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(301), 'updated', false), now()),
  (pg_temp.jid(1),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(301), 'updated', true),  now()),
  (pg_temp.jid(1),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(302), 'updated', false), now()),
  -- Decoys on Alex: a missing row, a malformed id, no id (pre-J7 event), another coach's row.
  (pg_temp.jid(1),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(999)), now()),
  (pg_temp.jid(1),  'coach',  'assessment_submitted', '{"assessment_id": "not-a-uuid"}', now()),
  (pg_temp.jid(1),  'coach',  'assessment_submitted', '{"mode": "full", "players": 1}', now()),
  (pg_temp.jid(1),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(305)), now()),
  -- Last week's save.
  (pg_temp.jid(1),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(303), 'updated', false), now() - interval '8 days'),
  -- A child forging a coach's save of their own assessment.
  (pg_temp.jid(11), 'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),
  -- The synthetic coach and the other academy's coach, each on their own row.
  (pg_temp.jid(3),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(304)), now()),
  (pg_temp.jid(4),  'coach',  'assessment_submitted', jsonb_build_object('assessment_id', pg_temp.jid(305)), now()),

  -- Child one opens the published message three times: one open.
  (pg_temp.jid(11), 'player', 'feedback_opened', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),
  (pg_temp.jid(11), 'player', 'feedback_opened', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),
  (pg_temp.jid(11), 'player', 'feedback_opened', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),
  -- Decoys: child two "opens" their unpublished message and child one's message.
  (pg_temp.jid(12), 'player', 'feedback_opened', jsonb_build_object('assessment_id', pg_temp.jid(302)), now()),
  (pg_temp.jid(12), 'player', 'feedback_opened', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),

  -- Parent one sees child one's bands twice: one open.
  (pg_temp.jid(21), 'parent', 'assessment_viewed', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),
  (pg_temp.jid(21), 'parent', 'assessment_viewed', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),
  -- Decoys: parent one on child two's assessment; a stranger on child one's;
  -- a parent sending the player's event type.
  (pg_temp.jid(21), 'parent', 'assessment_viewed', jsonb_build_object('assessment_id', pg_temp.jid(302)), now()),
  (pg_temp.jid(22), 'parent', 'assessment_viewed', jsonb_build_object('assessment_id', pg_temp.jid(301)), now()),
  (pg_temp.jid(21), 'parent', 'feedback_opened',   jsonb_build_object('assessment_id', pg_temp.jid(301)), now());

-- Reports run as service_role, the operator workflow (docs/pilot-runbook.md).
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── A. The answer ───────────────────────────────────────────
SELECT pg_temp.assert_true(pg_temp.metric('assessments', pg_temp.jid(1)) = 2,
  'A1: Alex made 2 assessments this week (one saved twice counts once; decoys ignored)');
SELECT pg_temp.assert_true(pg_temp.metric('assessments', pg_temp.jid(2)) = 0,
  'A2: the idle pilot coach is listed with 0, not missing');
SELECT pg_temp.assert_true(pg_temp.metric('player_opens') = 1,
  'A3: one player open: child one''s published message, opened three times');
SELECT pg_temp.assert_true(pg_temp.metric('parent_opens') = 1,
  'A4: one parent open: parent one on their own child''s assessment, seen twice');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.pilot_j7_this_week) = 4
  AND (SELECT bool_and(week = public.pilot_week(now())) FROM public.pilot_j7_this_week),
  'A5: exactly four rows, all for the current pilot week: Alex, Zoe, player_opens, parent_opens');

-- UC-T01: the count matches a manual count of the underlying rows.
SELECT pg_temp.assert_true(
  pg_temp.metric('assessments', pg_temp.jid(1)) = (
    SELECT count(DISTINCT ca.id) FROM public.coach_assessments ca
    JOIN public.telemetry_events t ON t.metadata ->> 'assessment_id' = ca.id::text
    WHERE ca.coach_user_id = pg_temp.jid(1) AND t.user_id = pg_temp.jid(1)
      AND t.event_type = 'assessment_submitted' AND t.created_at >= current_date),
  'A6: the reported number equals a hand count of Alex''s saved rows this week');

-- ── B. Each exclusion, named ────────────────────────────────
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.pilot_j7_this_week WHERE coach_user_id IN (pg_temp.jid(3), pg_temp.jid(4))),
  'B1: neither the synthetic coach nor the other academy''s coach is listed');
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.pilot_j7_assessments WHERE assessment_id IN (pg_temp.jid(304), pg_temp.jid(305))),
  'B2: their saves are not counted, and Alex''s claim on the other academy''s row is refused');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.pilot_j7_assessments WHERE coach_user_id = pg_temp.jid(11)) = 0,
  'B3: a child cannot manufacture an assessment by sending the coach''s event');
SELECT pg_temp.assert_true(
  (SELECT week FROM public.pilot_j7_assessments WHERE assessment_id = pg_temp.jid(303)) < public.pilot_week(now()),
  'B4: last week''s save is counted in its own week, not this one');
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.pilot_j7_opens WHERE user_id = pg_temp.jid(12)),
  'B5: no open for an unpublished message, or for another child''s message');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.pilot_j7_opens WHERE user_id = pg_temp.jid(21)) = 1
  AND NOT EXISTS (SELECT 1 FROM public.pilot_j7_opens WHERE user_id = pg_temp.jid(22)),
  'B6: parent opens only for a linked child; a stranger and a parent sending the player event count nothing');
SELECT pg_temp.assert_true(
  (SELECT created FROM public.pilot_j7_assessments WHERE assessment_id = pg_temp.jid(301)),
  'B7: an assessment first created this week is marked created, even though it was also edited');

-- ── C. The switches ─────────────────────────────────────────
-- The rehearsal switch brings the synthetic coach in, and only them.
RESET ROLE;
UPDATE public.pilot_config SET count_synthetic = true WHERE id;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.metric('assessments', pg_temp.jid(3)) = 1
  AND pg_temp.metric('assessments', pg_temp.jid(1)) = 2
  AND NOT EXISTS (SELECT 1 FROM public.pilot_j7_this_week WHERE coach_user_id = pg_temp.jid(4)),
  'C1: count_synthetic = true (rehearsal) counts the synthetic coach, still not the other academy');

-- No academy configured: every academy counts, synthetic still excluded.
RESET ROLE;
UPDATE public.pilot_config SET count_synthetic = false, org_id = NULL WHERE id;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true(pg_temp.metric('assessments', pg_temp.jid(4)) = 1
  AND NOT EXISTS (SELECT 1 FROM public.pilot_j7_this_week WHERE coach_user_id = pg_temp.jid(3)),
  'C2: with no pilot academy set, the other academy counts and the synthetic coach still does not');

RESET ROLE;
UPDATE public.pilot_config SET org_id = pg_temp.jid(101) WHERE id;

-- ── D. Reports are for the operator only ────────────────────
DO $test$
DECLARE actor record; report text; denied boolean;
BEGIN
  FOR actor IN SELECT * FROM (VALUES ('anon', NULL::integer), ('authenticated', 1), ('authenticated', 21)) AS a(db_role, n) LOOP
    EXECUTE format('SET LOCAL ROLE %I', actor.db_role);
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('role', actor.db_role, 'sub', pg_temp.jid(actor.n))::text, true);
    FOREACH report IN ARRAY ARRAY['pilot_j7_this_week', 'pilot_j7_assessments', 'pilot_j7_opens'] LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', report);
        denied := false;
      EXCEPTION WHEN insufficient_privilege THEN denied := true;
      END;
      IF NOT denied THEN
        RAISE EXCEPTION 'Assertion failed: D1: % (user %) can read %', actor.db_role, actor.n, report;
      END IF;
    END LOOP;
    BEGIN
      PERFORM count(*) FROM public.pilot_synthetic_user_ids();
      denied := false;
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'Assertion failed: D2: % can list synthetic account ids', actor.db_role;
    END IF;
    RESET ROLE;
  END LOOP;
END;
$test$;

SELECT pg_temp.assert_true(
  has_table_privilege('service_role', 'public.pilot_j7_this_week', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.pilot_j7_this_week', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'D3: service_role reads the report and cannot write through it');

ROLLBACK;

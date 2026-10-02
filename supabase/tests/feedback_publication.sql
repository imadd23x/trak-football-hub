-- @trak-suite mode=--feedback-publication-review in-all=true
-- T2 records remain protected while G7 disables this deferred AI workflow.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- G7 replaces publication/current-revision happy paths with denials. Keep the
-- original negative controls for direct mutation, forged authorship, foreign
-- coaches, children, anonymous callers and withdrawn consent. Historical rows
-- are seeded by the fixture owner because no app role can publish them now.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing feedback fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.fid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('96000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE feedback_results (description text, passed boolean, detail text);
GRANT INSERT ON feedback_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.fassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.feedback_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

-- Expects the statement to be refused. An unexpected success is rolled back by
-- the raised exception, so a vulnerable build reports rather than mutates.
CREATE FUNCTION pg_temp.fdenied(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE denied boolean := false; failure text; state text;
BEGIN
  BEGIN
    EXECUTE statement;
    -- Raising here also undoes an unexpectedly successful INSERT/UPDATE/DELETE,
    -- so a vulnerable build reports rather than mutating later assertions.
    RAISE EXCEPTION 'trak-unexpectedly-allowed';
  EXCEPTION
    WHEN OTHERS THEN
      state := SQLSTATE;
      IF SQLERRM = 'trak-unexpectedly-allowed' THEN
        denied := false; failure := 'statement succeeded';
      ELSIF state IN (
        '42501',  -- insufficient_privilege: RLS or a missing GRANT refused it
        'P0001'   -- raise_exception: one of our own RPC guards refused it
      ) THEN
        denied := true; failure := state;
      ELSE
        -- Any other error means the STATEMENT is broken, not that access was
        -- denied. Imad found this suite counting 42703 (undefined_column) as a
        -- successful denial: mutate a column name and all 16 assertions still
        -- passed, testing nothing. An unrecognised SQLSTATE now fails loudly
        -- and says which one, because a typo must never read as security.
        denied := false; failure := 'NOT A DENIAL — ' || state || ': ' || left(SQLERRM, 60);
      END IF;
  END;
  INSERT INTO pg_temp.feedback_results VALUES (description, denied, failure);
END;
$test$;

CREATE FUNCTION pg_temp.actor(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

-- ── Fixture: two academies, two coaches, one child ──────────────────────────

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.fid(1), 'adminA@f.test', now()),
  (pg_temp.fid(2), 'adminB@f.test', now()),
  (pg_temp.fid(10), 'coachA@f.test', now()),
  (pg_temp.fid(11), 'coachB@f.test', now()),
  (pg_temp.fid(20), 'child@f.test', now());

INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.fid(100), pg_temp.fid(1), 'Academy A', 'ACADA1'),
  (pg_temp.fid(101), pg_temp.fid(2), 'Academy B', 'ACADB1');

INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.fid(10), 'coach',  'Coach A', 'CCHA'),
  (pg_temp.fid(11), 'coach',  'Coach B', 'CCHB'),
  (pg_temp.fid(20), 'player', 'Child One', NULL);

INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.fid(10), pg_temp.fid(100)),
  (pg_temp.fid(11), pg_temp.fid(101));

-- Old enough that consent is not required, unless a test says otherwise.
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.fid(20), '2004-01-01');

INSERT INTO public.squad_players (id, coach_user_id, player_name, organization_id, status, linked_player_id)
VALUES (pg_temp.fid(200), pg_temp.fid(10), 'Child One', pg_temp.fid(100), 'active', pg_temp.fid(20));

INSERT INTO public.coach_assessments
  (id, coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability, organization_id)
VALUES (pg_temp.fid(300), pg_temp.fid(10), pg_temp.fid(200), 7,7,7,7,7,7, pg_temp.fid(100));

-- Retained revisions are still present, but the publication API is unavailable.
INSERT INTO public.player_feedback
  (squad_player_id, published_text, author_user_id, revision, superseded_at)
VALUES
  (pg_temp.fid(200), 'Great first touch this week.', pg_temp.fid(10), 1, now()),
  (pg_temp.fid(200), 'Updated after Saturday.', pg_temp.fid(10), 2, NULL);
SELECT pg_temp.fassert(
  (SELECT count(*) FROM public.player_feedback WHERE squad_player_id = pg_temp.fid(200)) = 2,
  'CONTROL historical feedback revisions exist before access denials');

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(pg_temp.fid(10));

SELECT pg_temp.fdenied(
  format('SELECT public.publish_player_feedback(%L, %L, NULL)', pg_temp.fid(200), 'new publication'),
  'G7 the owning coach cannot publish through the deferred AI workflow');
SELECT pg_temp.fdenied('SELECT published_text FROM public.player_feedback',
  'G7 the owning coach cannot read historical AI publications');

-- [F-1] Direct application DML remains closed; G7 also disables the RPC.
--
-- Honest note on the first of these three: with the grant restored it is still
-- refused, but by uq_player_feedback_one_current rather than by the missing
-- privilege, because this player already has a current row. That is defence in
-- depth and not a reason to drop the assertion, but the UPDATE and DELETE
-- cases below are the ones that actually discriminate — verified by restoring
-- the FOR ALL policy and watching exactly those two flip to FAIL.
SELECT pg_temp.fdenied(
  format('INSERT INTO public.player_feedback (squad_player_id, published_text, author_user_id) VALUES (%L, %L, %L)',
         pg_temp.fid(200), 'Straight past the RPC.', pg_temp.fid(10)),
  'F-1 a coach cannot INSERT a publication directly');

SELECT pg_temp.fdenied(
  format('UPDATE public.player_feedback SET published_text = %L WHERE squad_player_id = %L', 'rewritten', pg_temp.fid(200)),
  'F-1 a coach cannot rewrite a publication directly');

SELECT pg_temp.fdenied(
  format('DELETE FROM public.player_feedback WHERE squad_player_id = %L', pg_temp.fid(200)),
  'F-1 a coach cannot delete audit revisions');

-- [F-2] Provenance cannot be attributed to another coach.
SELECT pg_temp.fdenied(
  format('INSERT INTO public.ai_feedback_drafts (squad_player_id, generated_text, created_by) VALUES (%L, %L, %L)',
         pg_temp.fid(200), 'forged', pg_temp.fid(11)),
  'F-2 a draft cannot be attributed to another coach');

-- ── Academy B and a departed coach ──────────────────────────────────────────

SELECT pg_temp.actor(pg_temp.fid(11));

-- [3] A coach from another academy cannot publish against this player.
SELECT pg_temp.fdenied(
  format('SELECT public.publish_player_feedback(%L, %L, NULL)', pg_temp.fid(200), 'not mine'),
  '3 a coach from another academy cannot publish');

-- [1] and the draft table: a foreign coach sees no drafts.
DO $test$
DECLARE v_drafts integer;
BEGIN
  SELECT count(*) INTO v_drafts FROM public.ai_feedback_drafts WHERE squad_player_id = pg_temp.fid(200);
  PERFORM pg_temp.fassert(v_drafts = 0, '3 a foreign coach reads no drafts for that player', v_drafts || ' visible');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM pg_temp.fassert(true, '3 a foreign coach reads no drafts for that player', 'privilege denied');
END;
$test$;

-- ── The child ───────────────────────────────────────────────────────────────

SELECT pg_temp.actor(pg_temp.fid(20));

-- [1] A child cannot read drafts at all, by any route.
--
-- This assertion used to pass vacuously. By the time the child looked, every
-- draft had been consumed by publish_player_feedback(), so it counted zero rows
-- because there were none — not because the policy stopped it. Proven by
-- mutation: replacing the drafts SELECT policy with USING (true), so that any
-- authenticated user could read any coach's unapproved AI draft about any
-- child, left this suite entirely green. The most important claim T2 makes was
-- the one assertion that was not testing anything.
--
-- So: plant a draft as service_role, prove it is there, and only then look as
-- the child. The positive control is what makes the negative one mean anything.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO public.ai_feedback_drafts (squad_player_id, generated_text, created_by)
VALUES (pg_temp.fid(200), 'unapproved draft the child must never see', pg_temp.fid(10));
DO $test$
DECLARE v_drafts integer;
BEGIN
  SELECT count(*) INTO v_drafts FROM public.ai_feedback_drafts;
  PERFORM pg_temp.fassert(v_drafts > 0,
    '1-control a draft exists for the child to fail to read', v_drafts || ' present');
END;
$test$;

-- SET LOCAL ROLE authenticated, not RESET ROLE. RESET returns to the OWNER,
-- which bypasses RLS entirely — the first version of this control did that and
-- made the child appear to read the draft, which I nearly reported as a
-- product defect. pg_temp.actor() only sets the JWT claim; the database role
-- is a separate thing and it is the one RLS actually consults.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(pg_temp.fid(20));
DO $test$
DECLARE v_drafts integer;
BEGIN
  SELECT count(*) INTO v_drafts FROM public.ai_feedback_drafts;
  PERFORM pg_temp.fassert(v_drafts = 0, '1 a child reads no rows from ai_feedback_drafts', v_drafts || ' visible');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM pg_temp.fassert(true, '1 a child reads no rows from ai_feedback_drafts', 'privilege denied');
END;
$test$;

-- G7 closes both current and superseded AI text. Manual coach_shared_feedback
-- has its own positive read/publication controls in pilot_g7.sql.
SELECT pg_temp.fdenied('SELECT published_text FROM public.player_feedback WHERE superseded_at IS NULL',
  'G7 a child cannot read retained current AI feedback');
SELECT pg_temp.fdenied('SELECT published_text FROM public.player_feedback WHERE superseded_at IS NOT NULL',
  'G7 a child cannot read retained superseded AI feedback');

-- A child cannot publish on their own behalf.
SELECT pg_temp.fdenied(
  format('SELECT public.publish_player_feedback(%L, %L, NULL)', pg_temp.fid(200), 'I approve myself'),
  'a child cannot publish feedback to themselves');

-- ── [F-4] Anonymous callers ─────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT pg_temp.fdenied('TRUNCATE public.player_feedback', 'F-4 anon cannot TRUNCATE player_feedback');
SELECT pg_temp.fdenied('TRUNCATE public.ai_feedback_drafts', 'F-4 anon cannot TRUNCATE ai_feedback_drafts');

DO $test$
DECLARE v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM public.player_feedback;
  PERFORM pg_temp.fassert(v_rows = 0, 'F-4 anon reads no publications', v_rows || ' visible');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM pg_temp.fassert(true, 'F-4 anon reads no publications', 'privilege denied');
END;
$test$;

RESET ROLE;

-- ── [5] and [F-3] Consent ───────────────────────────────────────────────────
--
-- Make the child young enough to need consent, with none on record.

UPDATE public.player_details SET date_of_birth = (now() - interval '13 years')::date
WHERE user_id = pg_temp.fid(20);

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor(pg_temp.fid(10));

SELECT pg_temp.fdenied(
  format('SELECT public.publish_player_feedback(%L, %L, NULL)', pg_temp.fid(200), 'no consent on file'),
  '5 publishing is refused when parental consent is required and absent');

-- [F-3] What was published while consent held must stop being readable.
SELECT pg_temp.actor(pg_temp.fid(20));

DO $test$
DECLARE v_seen integer;
BEGIN
  SELECT count(*) INTO v_seen FROM public.player_feedback;
  PERFORM pg_temp.fassert(v_seen = 0,
    'F-3 a child without consent reads nothing, including what was published earlier',
    v_seen || ' row(s) still readable');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM pg_temp.fassert(true,
    'F-3 a child without consent reads nothing, including what was published earlier', 'privilege denied');
END;
$test$;

RESET ROLE;

-- ── Report ─────────────────────────────────────────────────────────────────

DO $test$
DECLARE failed integer; total integer; failures text;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.feedback_results;
  -- RAISE WARNING does not reach the runner, so a failing suite reported a
  -- count and never said which assertion. Carry the names in the exception's
  -- DETAIL, the way the other suites do.
  SELECT string_agg(r.description || coalesce(' [' || r.detail || ']', ''), E'\n' ORDER BY r.description)
    INTO failures FROM pg_temp.feedback_results r WHERE NOT r.passed;
  RAISE NOTICE 'Feedback publication assertions: % of % passed', total - failed, total;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Feedback publication: % of % desired assertions failed', failed, total
      USING DETAIL = failures;
  END IF;
END;
$test$;

ROLLBACK;

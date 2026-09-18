-- Unresolved PR40 storage audit: desired security assertions must stay RED
-- until the implementation is repaired. This is not a passing release suite.
-- Synthetic 960* identities only, inside one disposable transaction. No HTTP,
-- AI provider, production ACL, multiple-guardian or future P2 API is simulated.
-- A sole guardian and age 11 isolate failures from the inherited threshold15
-- policy. Native concurrent publication is a separate runner-owned audit.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing feedback fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.feedback_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('96000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE feedback_storage_results (
  finding text NOT NULL, assertion text NOT NULL, passed boolean NOT NULL, observed text
) ON COMMIT DROP;
GRANT INSERT ON feedback_storage_results TO authenticated, anon;

-- SECURITY INVOKER throughout: tested statements retain the actual client role.
CREATE FUNCTION pg_temp.feedback_check(ok boolean, finding text, assertion text, observed text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.feedback_storage_results VALUES (finding, assertion, ok IS TRUE, observed);
END;
$test$;
CREATE FUNCTION pg_temp.feedback_expect_no_rows(statement text, finding text, assertion text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE visible bigint;
BEGIN
  BEGIN
    EXECUTE statement INTO visible;
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.feedback_check(true, finding, assertion, 'permission denied');
    RETURN;
  WHEN OTHERS THEN
    PERFORM pg_temp.feedback_check(false, finding, assertion, SQLSTATE || ': ' || SQLERRM);
    RETURN;
  END;
  PERFORM pg_temp.feedback_check(visible = 0, finding, assertion, 'visible rows=' || visible);
END;
$test$;
CREATE FUNCTION pg_temp.feedback_expect_write_denied(
  statement text, finding text, assertion text, zero_rows_is_denial boolean DEFAULT false,
  expected_message text DEFAULT NULL, expected_constraint text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE changed bigint; failed_constraint text;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS changed = ROW_COUNT;
    -- A targeted UPDATE/DELETE filtered out by RLS is a denial. INSERT, DO,
    -- RPC and TRUNCATE success must fail even when ROW_COUNT happens to be 0.
    IF zero_rows_is_denial AND changed = 0 THEN
      PERFORM pg_temp.feedback_check(true, finding, assertion, 'zero rows changed');
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZF001', MESSAGE = 'unexpectedly allowed write';
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM pg_temp.feedback_check(true, finding, assertion, 'permission denied');
    WHEN SQLSTATE 'ZF001' THEN
      -- The exception rolls back the whole attempted write, including trigger
      -- and nested RPC effects, before the failed assertion is recorded.
      PERFORM pg_temp.feedback_check(false, finding, assertion, 'write succeeded (rolled back)');
    WHEN SQLSTATE 'P0001' THEN
      -- A deliberate application denial is valid too; never accept an
      -- arbitrary exception as proof that the authorization rule worked.
      PERFORM pg_temp.feedback_check(expected_message IS NOT NULL AND SQLERRM = expected_message,
        finding, assertion, SQLSTATE || ': ' || SQLERRM);
    WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
      PERFORM pg_temp.feedback_check(expected_constraint IS NOT NULL AND failed_constraint = expected_constraint,
        finding, assertion, SQLSTATE || ': ' || SQLERRM);
    WHEN OTHERS THEN
      PERFORM pg_temp.feedback_check(false, finding, assertion, SQLSTATE || ': ' || SQLERRM);
  END;
END;
$test$;
CREATE FUNCTION pg_temp.feedback_expect_canonical_write(statement text, check_statement text, assertion text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE canonical boolean;
BEGIN
  BEGIN
    EXECUTE statement;
    EXECUTE check_statement INTO canonical;
    -- Both rejection and server-stamping the authoritative academy are safe.
    -- Test the stored result, then undo it even when the implementation passes.
    RAISE EXCEPTION USING ERRCODE = 'ZF002', MESSAGE = 'rollback canonical-write probe';
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM pg_temp.feedback_check(true, 'FS2', assertion, 'permission denied');
    WHEN SQLSTATE 'ZF002' THEN
      PERFORM pg_temp.feedback_check(canonical, 'FS2', assertion,
        CASE WHEN canonical THEN 'authoritative provenance stored (rolled back)'
          ELSE 'foreign provenance stored (rolled back)' END);
    WHEN OTHERS THEN
      PERFORM pg_temp.feedback_check(false, 'FS2', assertion, SQLSTATE || ': ' || SQLERRM);
  END;
END;
$test$;
CREATE FUNCTION pg_temp.feedback_expect_rpc_denied(statement text, assertion text, expected_message text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION USING ERRCODE = 'ZF001', MESSAGE = 'unexpectedly allowed RPC';
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM pg_temp.feedback_check(true, 'CONTROL', assertion, 'permission denied');
    WHEN SQLSTATE 'P0001' THEN
      PERFORM pg_temp.feedback_check(SQLERRM = expected_message, 'CONTROL', assertion, SQLERRM);
    WHEN SQLSTATE 'ZF001' THEN
      PERFORM pg_temp.feedback_check(false, 'CONTROL', assertion, 'RPC succeeded (rolled back)');
    WHEN OTHERS THEN
      PERFORM pg_temp.feedback_check(false, 'CONTROL', assertion, SQLSTATE || ': ' || SQLERRM);
  END;
END;
$test$;

-- 1 coach A, 2 child A, 3 sole guardian, 4 unrelated parent, 5 coach B,
-- 6 adult B, 7/8 academy administrators, 9 unrelated adult, 10 unconsented child.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.feedback_id(n), 'feedback-review-' || n || '@test.invalid', now()
FROM generate_series(1, 10) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.feedback_id(1), 'coach', 'Synthetic Feedback Coach A'),
  (pg_temp.feedback_id(2), 'player', 'Synthetic Feedback Child A'),
  (pg_temp.feedback_id(3), 'parent', 'Synthetic Sole Guardian'),
  (pg_temp.feedback_id(4), 'parent', 'Synthetic Unrelated Parent'),
  (pg_temp.feedback_id(5), 'coach', 'Synthetic Feedback Coach B'),
  (pg_temp.feedback_id(6), 'player', 'Synthetic Feedback Adult B'),
  (pg_temp.feedback_id(7), 'club', 'Synthetic Academy A Administrator'),
  (pg_temp.feedback_id(8), 'club', 'Synthetic Academy B Administrator'),
  (pg_temp.feedback_id(9), 'player', 'Synthetic Unrelated Adult'),
  (pg_temp.feedback_id(10), 'player', 'Synthetic Unconsented Child');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.feedback_id(200), pg_temp.feedback_id(7), 'Synthetic Feedback Academy A', 'SYN-FB-A-960'),
  (pg_temp.feedback_id(201), pg_temp.feedback_id(8), 'Synthetic Feedback Academy B', 'SYN-FB-B-960');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.feedback_id(1), pg_temp.feedback_id(200)),
  (pg_temp.feedback_id(5), pg_temp.feedback_id(201));
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.feedback_id(2), (current_date - interval '11 years')::date),
  (pg_temp.feedback_id(6), (current_date - interval '22 years')::date),
  (pg_temp.feedback_id(9), (current_date - interval '22 years')::date),
  (pg_temp.feedback_id(10), (current_date - interval '11 years')::date);
-- Trusted relationship fixtures; no claim that these exercise invitation Auth.
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.feedback_id(100), pg_temp.feedback_id(1), 'Synthetic Feedback Child A', pg_temp.feedback_id(2)),
  (pg_temp.feedback_id(101), pg_temp.feedback_id(5), 'Synthetic Feedback Adult B', pg_temp.feedback_id(6)),
  (pg_temp.feedback_id(102), pg_temp.feedback_id(1), 'Synthetic Unconsented Child', pg_temp.feedback_id(10));
INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
VALUES (pg_temp.feedback_id(2), pg_temp.feedback_id(3));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(3), 'role', 'authenticated')::text, true);
SELECT public.record_parental_consent(pg_temp.feedback_id(2), 'parent',
  '{"coaching_records":true,"recognition":true,"parent_visibility":true}',
  'synthetic-feedback-review', 'Synthetic test wording; not an approved real-user notice');
SELECT pg_temp.feedback_check(NOT public.player_consent_required(pg_temp.feedback_id(2)),
  'CONTROL', 'actual guardian grant authorizes the age-11 fixture');

-- Positive controls create assessments/drafts as the owning coach, not owner.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(5), 'role', 'authenticated')::text, true);
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id)
VALUES (pg_temp.feedback_id(301), pg_temp.feedback_id(5), pg_temp.feedback_id(101));
INSERT INTO public.ai_feedback_drafts (id, squad_player_id, assessment_id, organization_id, generated_text, created_by)
VALUES (pg_temp.feedback_id(401), pg_temp.feedback_id(101), pg_temp.feedback_id(301), pg_temp.feedback_id(201),
  'SYNTHETIC PRIVATE DRAFT B', pg_temp.feedback_id(5));
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(1), 'role', 'authenticated')::text, true);
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id)
VALUES (pg_temp.feedback_id(300), pg_temp.feedback_id(1), pg_temp.feedback_id(100));
INSERT INTO public.ai_feedback_drafts (id, squad_player_id, assessment_id, organization_id, generated_text, created_by)
VALUES (pg_temp.feedback_id(400), pg_temp.feedback_id(100), pg_temp.feedback_id(300), pg_temp.feedback_id(200),
  'SYNTHETIC PRIVATE DRAFT A', pg_temp.feedback_id(1));
SELECT pg_temp.feedback_check((SELECT count(*) = 1 FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(400)),
  'CONTROL', 'owning coach can read the nonempty draft fixture');
SELECT public.publish_player_feedback(pg_temp.feedback_id(100), 'SYNTHETIC APPROVED VERSION ONE', pg_temp.feedback_id(400));
SELECT pg_temp.feedback_check((SELECT count(*) = 1 FROM public.player_feedback
  WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 1 AND superseded_at IS NULL
    AND assessment_id = pg_temp.feedback_id(300) AND organization_id = pg_temp.feedback_id(200)
    AND author_user_id = pg_temp.feedback_id(1) AND draft_id = pg_temp.feedback_id(400)
    AND published_text = 'SYNTHETIC APPROVED VERSION ONE'),
  'CONTROL', 'valid publication stamps own author academy assessment and draft');
SELECT public.publish_player_feedback(pg_temp.feedback_id(100), 'SYNTHETIC APPROVED VERSION TWO');
SELECT pg_temp.feedback_check((SELECT count(*) = 2 AND count(*) FILTER (WHERE superseded_at IS NULL) = 1
  FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100)),
  'CONTROL', 'sequential publication retains two revisions with exactly one current');
SELECT pg_temp.feedback_check((SELECT count(*) = 1 FROM public.player_feedback
  WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 2 AND superseded_at IS NULL
    AND draft_id IS NULL AND assessment_id IS NULL AND author_user_id = pg_temp.feedback_id(1)
    AND published_text = 'SYNTHETIC APPROVED VERSION TWO'),
  'CONTROL', 'coach-authored revision has no invented draft or assessment provenance');

-- Once a draft has been published, deleting it must not erase provenance.
-- RLS/ACL denial or this exact FK restriction are safe. This does not require
-- a particular policy for discarding drafts that were never published.
SELECT pg_temp.feedback_expect_write_denied(
  'DELETE FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(400)',
  'FS7', 'coach cannot erase a published revision draft provenance', true, NULL,
  'player_feedback_draft_id_fkey');

-- Denied RPCs are positive controls: require an intentional denial, not an
-- arbitrary constraint/syntax/runtime error. Unexpected successes roll back.
SELECT pg_temp.feedback_expect_rpc_denied(
  'SELECT public.publish_player_feedback(pg_temp.feedback_id(100), ''   '')',
  'empty feedback is rejected', 'Feedback cannot be empty');
SELECT pg_temp.feedback_expect_rpc_denied(
  'SELECT public.publish_player_feedback(pg_temp.feedback_id(100), NULL)',
  'null feedback is rejected', 'Feedback cannot be empty');
SELECT pg_temp.feedback_expect_rpc_denied(
  'SELECT public.publish_player_feedback(pg_temp.feedback_id(100), ''synthetic'', pg_temp.feedback_id(999))',
  'missing draft is rejected', 'That draft does not belong to this player');
SELECT pg_temp.feedback_expect_rpc_denied(
  'SELECT public.publish_player_feedback(pg_temp.feedback_id(100), ''synthetic'', pg_temp.feedback_id(401))',
  'another player draft is rejected by the RPC', 'That draft does not belong to this player');
SELECT pg_temp.feedback_expect_rpc_denied(
  'SELECT public.publish_player_feedback(pg_temp.feedback_id(101), ''synthetic'')',
  'another academy roster is rejected by the RPC', 'Not your player');
SELECT pg_temp.feedback_check(public.squad_player_consent_required(pg_temp.feedback_id(102)),
  'CONTROL', 'second age-11 child really requires consent before bypass attempt');
SELECT pg_temp.feedback_expect_rpc_denied(
  'SELECT public.publish_player_feedback(pg_temp.feedback_id(102), ''synthetic'')',
  'unconsented child is rejected by the RPC', 'Parental consent has not been given for this player');

-- Durable desired assertions, not passing expectations of the known bugs.
SELECT pg_temp.feedback_expect_write_denied(
  'INSERT INTO public.player_feedback (id, squad_player_id, published_text, author_user_id)
   VALUES (pg_temp.feedback_id(500), pg_temp.feedback_id(102), ''SYNTHETIC WITHOUT CONSENT'', pg_temp.feedback_id(1))',
  'FS1', 'direct publication cannot bypass missing guardian consent');
SELECT pg_temp.feedback_expect_write_denied(
  'INSERT INTO public.player_feedback (id, squad_player_id, organization_id, published_text, author_user_id)
   VALUES (pg_temp.feedback_id(501), pg_temp.feedback_id(100), pg_temp.feedback_id(200), ''SYNTHETIC FORGED AUTHOR'', pg_temp.feedback_id(5))',
  'FS1', 'direct publication cannot attribute another coach as author');
SELECT pg_temp.feedback_expect_write_denied(
  'INSERT INTO public.player_feedback (id, squad_player_id, organization_id, published_text, author_user_id)
   VALUES (pg_temp.feedback_id(502), pg_temp.feedback_id(100), pg_temp.feedback_id(201), ''SYNTHETIC FOREIGN ACADEMY'', pg_temp.feedback_id(1))',
  'FS1', 'direct publication cannot forge a foreign academy');
SELECT pg_temp.feedback_expect_write_denied(
  'UPDATE public.player_feedback SET published_text = ''SYNTHETIC SILENT REWRITE''
   WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 1',
  'FS1', 'published audit text cannot be overwritten in place', true);
SELECT pg_temp.feedback_expect_write_denied(
  'UPDATE public.player_feedback SET superseded_at = NULL
   WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 1',
  'FS1', 'superseded audit revision cannot be republished by direct update', true);
SELECT pg_temp.feedback_expect_write_denied(
  'DELETE FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 1',
  'FS1', 'published revision audit history cannot be deleted directly', true);

SELECT pg_temp.feedback_expect_write_denied(
  'INSERT INTO public.ai_feedback_drafts (id, squad_player_id, assessment_id, organization_id, generated_text, created_by)
   VALUES (pg_temp.feedback_id(402), pg_temp.feedback_id(100), pg_temp.feedback_id(301), pg_temp.feedback_id(200), ''SYNTHETIC FOREIGN ASSESSMENT'', pg_temp.feedback_id(1))',
  'FS2', 'own-roster draft cannot reference a foreign player assessment', false,
  'That assessment does not belong to this player');
SELECT pg_temp.feedback_expect_canonical_write(
  'INSERT INTO public.ai_feedback_drafts (id, squad_player_id, assessment_id, organization_id, generated_text, created_by)
   VALUES (pg_temp.feedback_id(403), pg_temp.feedback_id(100), pg_temp.feedback_id(300), pg_temp.feedback_id(201), ''SYNTHETIC FOREIGN ORG'', pg_temp.feedback_id(1))',
  'SELECT count(*) = 1 FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(403)
    AND organization_id = pg_temp.feedback_id(200) AND assessment_id = pg_temp.feedback_id(300)
    AND squad_player_id = pg_temp.feedback_id(100) AND created_by = pg_temp.feedback_id(1)',
  'draft academy must match its roster and assessment');
SELECT pg_temp.feedback_expect_write_denied(
  'INSERT INTO public.ai_feedback_drafts (id, squad_player_id, assessment_id, organization_id, generated_text, created_by)
   VALUES (pg_temp.feedback_id(404), pg_temp.feedback_id(100), pg_temp.feedback_id(300), pg_temp.feedback_id(200), ''SYNTHETIC FORGED CREATOR'', pg_temp.feedback_id(5))',
  'FS2', 'draft creator cannot impersonate another coach');
SELECT pg_temp.feedback_expect_write_denied(
  'UPDATE public.ai_feedback_drafts SET assessment_id = pg_temp.feedback_id(301)
   WHERE id = pg_temp.feedback_id(400)',
  'FS2', 'existing draft cannot be retargeted to a foreign assessment', true);
SELECT pg_temp.feedback_expect_write_denied($attempt$
  DO $attack$
  BEGIN
    INSERT INTO public.ai_feedback_drafts (id, squad_player_id, assessment_id, organization_id, generated_text, created_by)
    VALUES (pg_temp.feedback_id(405), pg_temp.feedback_id(100), pg_temp.feedback_id(301), pg_temp.feedback_id(201),
      'SYNTHETIC FOREIGN PROVENANCE', pg_temp.feedback_id(5));
    PERFORM public.publish_player_feedback(pg_temp.feedback_id(100), 'SYNTHETIC POISONED PUBLICATION', pg_temp.feedback_id(405));
  END;
  $attack$;
$attempt$, 'FS2', 'draft plus publication cannot carry foreign assessment provenance through the real RPC', false,
  'That assessment does not belong to this player');

-- Isolation controls test nonempty rows and explicit identities.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(2), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_check((SELECT count(*) = 1 FROM public.player_feedback
  WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 2
    AND published_text = 'SYNTHETIC APPROVED VERSION TWO'),
  'CONTROL', 'linked child reads only the explicit current approved text');
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 1',
  'CONTROL', 'linked child cannot read superseded publications');
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(400)',
  'CONTROL', 'linked child cannot read the nonempty private draft');
SELECT pg_temp.feedback_expect_rpc_denied('SELECT public.publish_player_feedback(pg_temp.feedback_id(100), ''synthetic'')',
  'child cannot publish their own feedback', 'Not your player');
SELECT pg_temp.feedback_expect_write_denied(
  'UPDATE public.player_feedback SET published_text = ''SYNTHETIC CHILD REWRITE'' WHERE squad_player_id = pg_temp.feedback_id(100)',
  'CONTROL', 'child cannot directly modify approved feedback', true);

SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(3), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(400)',
  'CONTROL', 'linked guardian cannot read private AI drafts');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(4), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100)',
  'CONTROL', 'unrelated guardian cannot read approved feedback');
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(400)',
  'CONTROL', 'unrelated guardian cannot read private drafts');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(9), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100)',
  'CONTROL', 'unrelated player cannot read approved feedback');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(5), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100)',
  'CONTROL', 'foreign academy coach cannot read publication history');
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(400)',
  'CONTROL', 'foreign academy coach cannot read private drafts');

-- Actual sole-guardian withdrawal; this intentionally does not prescribe the
-- unresolved multi-guardian rule or claim under18/academy-purpose coverage.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(3), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_check(public.withdraw_parental_consent(pg_temp.feedback_id(2)) = 1,
  'CONTROL', 'real withdrawal closes exactly one active sole-guardian approval');
SELECT pg_temp.feedback_check(public.player_consent_required(pg_temp.feedback_id(2)),
  'CONTROL', 'withdrawal really makes the existing helper require consent');
SELECT pg_temp.feedback_check((SELECT count(*) = 1 FROM public.player_parent_links
  WHERE player_user_id = pg_temp.feedback_id(2) AND parent_user_id = pg_temp.feedback_id(3)),
  'CONTROL', 'withdrawal preserves the identity link');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(2), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100)',
  'FS3', 'guardian withdrawal revokes child access to previously published feedback');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.feedback_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.feedback_expect_rpc_denied('SELECT public.publish_player_feedback(pg_temp.feedback_id(100), ''synthetic after withdrawal'')',
  'real publication RPC rejects withdrawn consent', 'Parental consent has not been given for this player');

-- TRUNCATE is a database-role ACL test, not a claimed PostgREST HTTP endpoint.
-- Both tables are named to respect their FK, and unexpected success is undone.
SELECT pg_temp.feedback_expect_write_denied('TRUNCATE public.player_feedback, public.ai_feedback_drafts',
  'FS4', 'authenticated client role cannot truncate all feedback and draft history');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.player_feedback',
  'CONTROL', 'anonymous role cannot read publications');
SELECT pg_temp.feedback_expect_no_rows('SELECT count(*) FROM public.ai_feedback_drafts',
  'CONTROL', 'anonymous role cannot read drafts');
SELECT pg_temp.feedback_expect_rpc_denied('SELECT public.publish_player_feedback(pg_temp.feedback_id(100), ''synthetic'')',
  'anonymous caller cannot publish', 'Not authenticated');
SELECT pg_temp.feedback_expect_write_denied('TRUNCATE public.player_feedback, public.ai_feedback_drafts',
  'FS4', 'anonymous database role cannot truncate all feedback and draft history');

RESET ROLE;
SELECT pg_temp.feedback_check((SELECT count(*) = 2 AND count(*) FILTER (WHERE superseded_at IS NULL) = 1
  FROM public.player_feedback WHERE squad_player_id = pg_temp.feedback_id(100)),
  'CONTROL', 'unexpected publication mutations and truncations left both original revisions intact');
SELECT pg_temp.feedback_check((SELECT count(*) = 1 FROM public.player_feedback
  WHERE squad_player_id = pg_temp.feedback_id(100) AND revision = 1 AND superseded_at IS NOT NULL
    AND published_text = 'SYNTHETIC APPROVED VERSION ONE' AND author_user_id = pg_temp.feedback_id(1)
    AND organization_id = pg_temp.feedback_id(200) AND draft_id = pg_temp.feedback_id(400)
    AND assessment_id = pg_temp.feedback_id(300)),
  'CONTROL', 'rolled-back audit mutations preserve original text author academy and provenance');
SELECT pg_temp.feedback_check((SELECT count(*) = 2 FROM public.ai_feedback_drafts
  WHERE id IN (pg_temp.feedback_id(400), pg_temp.feedback_id(401)))
  AND (SELECT count(*) = 0 FROM public.ai_feedback_drafts WHERE id BETWEEN pg_temp.feedback_id(402) AND pg_temp.feedback_id(405))
  AND (SELECT assessment_id = pg_temp.feedback_id(300) FROM public.ai_feedback_drafts WHERE id = pg_temp.feedback_id(400))
  AND (SELECT count(*) = 0 FROM public.player_feedback WHERE id BETWEEN pg_temp.feedback_id(500) AND pg_temp.feedback_id(502)),
  'CONTROL', 'unexpected draft inserts retargeting and direct publications were rolled back');

-- Log every result before the terminal error, including under psql ON_ERROR_STOP.
DO $test$
DECLARE result record; total integer; failed integer; controls integer; control_failures integer; details text;
BEGIN
  FOR result IN SELECT * FROM pg_temp.feedback_storage_results ORDER BY finding, assertion LOOP
    RAISE NOTICE '% | % | % | %', CASE WHEN result.passed THEN 'PASS' ELSE 'FAIL' END,
      result.finding, result.assertion, coalesce(result.observed, '');
  END LOOP;
  SELECT count(*), count(*) FILTER (WHERE NOT passed),
    count(*) FILTER (WHERE finding = 'CONTROL'), count(*) FILTER (WHERE finding = 'CONTROL' AND NOT passed)
  INTO total, failed, controls, control_failures FROM pg_temp.feedback_storage_results;
  SELECT string_agg(finding || ': ' || assertion || coalesce(' [' || observed || ']', ''), E'\n' ORDER BY finding, assertion)
  INTO details FROM pg_temp.feedback_storage_results WHERE NOT passed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Feedback storage audit: %/% desired assertions failed; %/% controls failed',
      failed, total, control_failures, controls USING DETAIL = details;
  END IF;
END;
$test$;
SELECT count(*) AS feedback_storage_assertions FROM pg_temp.feedback_storage_results;
-- Failure aborts the transaction; the runner discards its database. No COMMIT.
ROLLBACK;

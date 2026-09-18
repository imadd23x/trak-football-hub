-- UNRESOLVED privacy/consent audit, not a passing release suite.
-- Port of audit 78f771b with unchanged behavior assertions and explicit IDs.
-- Structured results feed the reviewed debt ratchet; failures are never discarded.
-- Only disposable databases; actual authenticated roles; no live fixtures.
-- No multi-guardian rule or not-yet-implemented academy consent API is assumed.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing consent/privacy fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.privacy_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('95000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE consent_privacy_results (
  finding text NOT NULL, id text PRIMARY KEY, assertion text NOT NULL, passed boolean NOT NULL, observed text
) ON COMMIT DROP;
GRANT INSERT ON consent_privacy_results TO authenticated;

-- These helpers are SECURITY INVOKER: the tested SQL retains the caller's RLS.
CREATE FUNCTION pg_temp.privacy_check(ok boolean, finding text, id text, assertion text, observed text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.consent_privacy_results VALUES (finding, id, assertion, ok IS TRUE, observed);
END;
$test$;
CREATE FUNCTION pg_temp.privacy_expect_no_rows(statement text, finding text, id text, assertion text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE visible bigint;
BEGIN
  BEGIN
    EXECUTE statement INTO visible;
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.privacy_check(true, finding, id, assertion, 'permission denied');
    RETURN;
  END;
  -- Zero RLS-visible rows is denial too. Other SQL/runtime errors are not.
  PERFORM pg_temp.privacy_check(visible = 0, finding, id, assertion, 'visible rows=' || visible);
END;
$test$;
CREATE FUNCTION pg_temp.privacy_expect_write_denied(statement text, finding text, id text, assertion text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  BEGIN
    EXECUTE statement;
    -- Undo any unexpected successful INSERT before collecting its failure.
    RAISE EXCEPTION USING ERRCODE = 'ZP001', MESSAGE = 'unexpectedly allowed write';
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM pg_temp.privacy_check(true, finding, id, assertion, 'permission denied');
    WHEN SQLSTATE 'ZP001' THEN
      PERFORM pg_temp.privacy_check(false, finding, id, assertion, 'INSERT succeeded (rolled back)');
  END;
END;
$test$;

-- 1 coach, 2 child, 3 sole linked guardian, 4 unrelated parent.
-- A child aged 11 is below both the legacy 15 and approved pilot 18 thresholds.
-- Link setup is trusted fixture creation; invitation proof belongs to P1 tests.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.privacy_id(n), 'consent-privacy-' || n || '@test.invalid', now()
FROM generate_series(1, 4) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.privacy_id(1), 'coach', 'Synthetic Privacy Coach'),
  (pg_temp.privacy_id(2), 'player', 'Synthetic Privacy Child'),
  (pg_temp.privacy_id(3), 'parent', 'Synthetic Sole Guardian'),
  (pg_temp.privacy_id(4), 'parent', 'Synthetic Unrelated Parent');
INSERT INTO public.coach_details (user_id) VALUES (pg_temp.privacy_id(1));
INSERT INTO public.player_details (user_id, date_of_birth)
VALUES (pg_temp.privacy_id(2), (current_date - interval '11 years')::date);
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id)
VALUES (pg_temp.privacy_id(10), pg_temp.privacy_id(1), 'Synthetic Privacy Child', pg_temp.privacy_id(2));
INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
VALUES (pg_temp.privacy_id(2), pg_temp.privacy_id(3));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(3), 'role', 'authenticated')::text, true);
SELECT public.record_parental_consent(pg_temp.privacy_id(2), 'parent',
  '{"coaching_records":true,"recognition":true,"parent_visibility":true}',
  'synthetic-privacy-review', 'Synthetic fixture wording; not an approved real-user notice');
SELECT pg_temp.privacy_check(NOT public.player_consent_required(pg_temp.privacy_id(2)),
  'CONTROL', 'control.grant-authorizes', 'real grant RPC authorizes the synthetic minor under the existing contract');

-- Positive controls exercise real permitted writes, not just preseeded rows.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(1), 'role', 'authenticated')::text, true);
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id)
VALUES (pg_temp.privacy_id(20), pg_temp.privacy_id(1), pg_temp.privacy_id(10));
INSERT INTO public.coach_assessment_notes (assessment_id, coach_user_id, note)
VALUES (pg_temp.privacy_id(20), pg_temp.privacy_id(1), 'SYNTHETIC PRIVATE NOTE SENTINEL');
INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type, note)
VALUES (pg_temp.privacy_id(30), pg_temp.privacy_id(1), pg_temp.privacy_id(10), 'player_of_week', 'Synthetic message to player');
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.coach_assessment_notes WHERE assessment_id = pg_temp.privacy_id(20)),
  'CONTROL', 'control.coach-private-note-visible', 'owner coach can read the nonempty private-note fixture');

SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(2), 'role', 'authenticated')::text, true);
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group)
VALUES (pg_temp.privacy_id(40), pg_temp.privacy_id(2), 'CM', 'Synthetic friendly', 'Home', 'U12');
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.coach_assessments WHERE id = pg_temp.privacy_id(20)),
  'CONTROL', 'control.child-assessment-visible', 'linked child can read the assessment while its separate private note is protected');
SELECT pg_temp.privacy_expect_no_rows(
  'SELECT count(*) FROM public.coach_assessment_notes WHERE assessment_id = pg_temp.privacy_id(20)',
  'CP1', 'CP1.child-private-note-denied', 'linked child cannot SELECT the historical private assessment note');

SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(3), 'role', 'authenticated')::text, true);
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.coach_assessments WHERE id = pg_temp.privacy_id(20)),
  'CONTROL', 'control.parent-assessment-visible', 'linked parent with visibility enabled reads the existing assessment');
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.recognition_awards WHERE id = pg_temp.privacy_id(30)),
  'CONTROL', 'control.parent-award-visible', 'linked parent with visibility and recognition enabled reads the existing award');
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.matches WHERE id = pg_temp.privacy_id(40)),
  'CONTROL', 'control.parent-match-visible', 'linked parent with visibility enabled reads the existing match');
SELECT pg_temp.privacy_expect_no_rows(
  'SELECT count(*) FROM public.coach_assessment_notes WHERE assessment_id = pg_temp.privacy_id(20)',
  'CONTROL', 'control.parent-private-note-denied', 'linked parent cannot SELECT the private assessment note even with visibility enabled');

SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(4), 'role', 'authenticated')::text, true);
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.coach_assessments WHERE id = pg_temp.privacy_id(20)',
  'CONTROL', 'control.unrelated-assessment-denied', 'unrelated parent cannot read the assessment');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.recognition_awards WHERE id = pg_temp.privacy_id(30)',
  'CONTROL', 'control.unrelated-award-denied', 'unrelated parent cannot read the award');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.matches WHERE id = pg_temp.privacy_id(40)',
  'CONTROL', 'control.unrelated-match-denied', 'unrelated parent cannot read the match');

-- Change only parent visibility; keep coaching and recognition approved.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(3), 'role', 'authenticated')::text, true);
SELECT public.record_parental_consent(pg_temp.privacy_id(2), 'parent',
  '{"coaching_records":true,"recognition":true,"parent_visibility":false}',
  'synthetic-privacy-review', 'Synthetic fixture wording; not an approved real-user notice');
SELECT pg_temp.privacy_check(EXISTS (SELECT 1 FROM public.parental_consents
  WHERE player_user_id = pg_temp.privacy_id(2) AND withdrawn_at IS NULL
    AND purposes -> 'parent_visibility' = 'false'::jsonb),
  'CONTROL', 'control.visibility-choice-recorded', 'real grant RPC records parent visibility as false');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.coach_assessments WHERE id = pg_temp.privacy_id(20)',
  'CP2', 'CP2.visibility-assessment-denied', 'parent_visibility=false denies parent assessment reads');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.recognition_awards WHERE id = pg_temp.privacy_id(30)',
  'CP2', 'CP2.visibility-award-denied', 'parent_visibility=false denies parent award reads');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.matches WHERE id = pg_temp.privacy_id(40)',
  'CP2', 'CP2.visibility-match-denied', 'parent_visibility=false denies parent match reads');

-- Recognition is tested independently: visibility/coaching remain approved.
SELECT public.record_parental_consent(pg_temp.privacy_id(2), 'parent',
  '{"coaching_records":true,"recognition":false,"parent_visibility":true}',
  'synthetic-privacy-review', 'Synthetic fixture wording; not an approved real-user notice');
SELECT pg_temp.privacy_check(EXISTS (SELECT 1 FROM public.parental_consents
  WHERE player_user_id = pg_temp.privacy_id(2) AND withdrawn_at IS NULL
    AND purposes -> 'recognition' = 'false'::jsonb),
  'CONTROL', 'control.recognition-choice-recorded', 'real grant RPC records recognition as false');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.privacy_expect_write_denied(
  'INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type) VALUES (pg_temp.privacy_id(31), pg_temp.privacy_id(1), pg_temp.privacy_id(10), ''player_of_week'')',
  'CP4', 'CP4.recognition-insert-denied', 'recognition=false denies the owning coach direct award INSERT');
SELECT pg_temp.privacy_check((SELECT count(*) = 0 FROM public.recognition_awards WHERE id = pg_temp.privacy_id(31)),
  'CONTROL', 'control.unexpected-write-rolled-back', 'an unexpectedly allowed award write is rolled back by the audit helper');

-- Restore all choices, prove visibility, then use the actual withdrawal RPC.
-- Exactly one guardian exists; no pending multi-guardian precedence is encoded.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.privacy_id(3), 'role', 'authenticated')::text, true);
SELECT public.record_parental_consent(pg_temp.privacy_id(2), 'parent',
  '{"coaching_records":true,"recognition":true,"parent_visibility":true}',
  'synthetic-privacy-review', 'Synthetic fixture wording; not an approved real-user notice');
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.matches WHERE id = pg_temp.privacy_id(40)),
  'CONTROL', 'control.restored-match-visible', 'all-true approval restores visibility before withdrawal');
SELECT pg_temp.privacy_check(public.withdraw_parental_consent(pg_temp.privacy_id(2)) = 1,
  'CONTROL', 'control.withdraw-one-consent', 'actual sole-guardian withdrawal closes exactly one active consent');
SELECT pg_temp.privacy_check(public.player_consent_required(pg_temp.privacy_id(2)),
  'CONTROL', 'control.withdrawal-requires-consent', 'withdrawal makes the existing consent helper require approval again');
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.player_parent_links
  WHERE player_user_id = pg_temp.privacy_id(2) AND parent_user_id = pg_temp.privacy_id(3)),
  'CONTROL', 'control.withdrawal-preserves-link', 'withdrawal preserves the identity link and is not confused with unlinking');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.coach_assessments WHERE id = pg_temp.privacy_id(20)',
  'CP3', 'CP3.withdrawal-assessment-denied', 'sole-guardian withdrawal denies parent assessment reads');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.recognition_awards WHERE id = pg_temp.privacy_id(30)',
  'CP3', 'CP3.withdrawal-award-denied', 'sole-guardian withdrawal denies parent award reads');
SELECT pg_temp.privacy_expect_no_rows('SELECT count(*) FROM public.matches WHERE id = pg_temp.privacy_id(40)',
  'CP3', 'CP3.withdrawal-match-denied', 'sole-guardian withdrawal denies parent match reads');

RESET ROLE;
SELECT pg_temp.privacy_check((SELECT count(*) = 4 AND bool_and(withdrawn_at IS NOT NULL)
  FROM public.parental_consents WHERE player_user_id = pg_temp.privacy_id(2)),
  'CONTROL', 'control.consent-evidence-retained', 'four actual grant records remain as evidence after supersession and withdrawal');
SELECT pg_temp.privacy_check((SELECT count(*) = 1 FROM public.coach_assessments WHERE id = pg_temp.privacy_id(20))
  AND (SELECT count(*) = 1 FROM public.recognition_awards WHERE id = pg_temp.privacy_id(30))
  AND (SELECT count(*) = 1 FROM public.matches WHERE id = pg_temp.privacy_id(40)),
  'CONTROL', 'control.development-records-retained', 'read denials are not achieved by deleting the development records');

-- The runner validates the full reviewed ID/kind inventory before evaluation.
-- Unexpected SQL errors propagate. Only the explicit 42501 denial is accepted;
-- the ZP001 sentinel rolls back an actually successful write and records FAIL.
SELECT jsonb_build_object(
  'version', 1, 'suite', 'consent-privacy',
  'assertions', jsonb_agg(jsonb_build_object(
    'id', id,
    'kind', CASE WHEN finding = 'CONTROL' THEN 'control' ELSE 'check' END,
    'status', CASE WHEN passed THEN 'pass' ELSE 'fail' END,
    'detail', assertion || coalesce(' [' || observed || ']', '')
  ) ORDER BY id)
) AS consent_privacy_audit_result FROM pg_temp.consent_privacy_results;
-- No COMMIT: even deliberately unexpected writes and all fixture identities
-- remain confined to this rolled-back transaction and the in-memory database.
ROLLBACK;

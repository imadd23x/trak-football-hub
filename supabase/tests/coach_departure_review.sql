-- @trak-suite mode=--coach-departure-review in-all=true
-- Departure security regression: these assertions fail on K1/K2 at 6875968.
-- Run ONLY through the disposable in-memory harness, never a shared database.
-- This is separate from the passing parent-invitation suite. It deliberately
-- reports vulnerable behavior as failure, not as a successful reproduction.
-- All six findings are exercised before the aggregate exception is raised.
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing coach-departure fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE TEMP TABLE departure_review_failures (
  finding text NOT NULL,
  assertion text NOT NULL
) ON COMMIT DROP;
GRANT INSERT ON departure_review_failures TO authenticated;

-- Keep assertions under the caller's actual role. This helper does not grant
-- access to application data, bypass RLS, or replace application functions.
CREATE FUNCTION pg_temp.departure_check(ok boolean, finding text, assertion text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    INSERT INTO pg_temp.departure_review_failures VALUES (finding, assertion);
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.departure_expect_denied(statement text, finding text, assertion text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE
  affected bigint;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS affected = ROW_COUNT;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN;
    WHEN raise_exception THEN
      -- Existing RPCs use P0001 for authorization errors. Do not mistake an
      -- unrelated SQL/runtime failure for proof of access being denied.
      IF SQLERRM ~* '^not authori[sz]ed([ :—-]|$)' THEN
        RETURN;
      END IF;
      RAISE;
  END;
  -- RLS may silently hide rows from DELETE. That is a valid denial too.
  PERFORM pg_temp.departure_check(affected = 0, finding, assertion);
END;
$test$;

-- Entirely synthetic adults avoid conflating departure checks with the
-- separately owned under-18 consent work. Academy C isolates FK cleanup.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT ('90000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'departure-review-' || i || '@test.invalid', now()
FROM generate_series(1, 8) i;

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('90000000-0000-0000-0000-000000000001', 'coach', 'Review Coach A'),
  ('90000000-0000-0000-0000-000000000002', 'coach', 'Review Coach B'),
  ('90000000-0000-0000-0000-000000000003', 'club', 'Review Admin A'),
  ('90000000-0000-0000-0000-000000000004', 'club', 'Review Admin B'),
  ('90000000-0000-0000-0000-000000000005', 'player', 'Review Player A'),
  ('90000000-0000-0000-0000-000000000006', 'player', 'Review Archived Player A'),
  ('90000000-0000-0000-0000-000000000007', 'club', 'Review Admin C'),
  ('90000000-0000-0000-0000-000000000008', 'coach', 'Review Coach C');

INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  ('90000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000003', 'Review Academy A', 'REVIEW-A'),
  ('90000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000004', 'Review Academy B', 'REVIEW-B'),
  ('90000000-0000-0000-0000-000000000012', '90000000-0000-0000-0000-000000000007', 'Review Academy C', 'REVIEW-C');

INSERT INTO public.coach_details (user_id, organization_id) VALUES
  ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000010'),
  ('90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000011'),
  ('90000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000012');

INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  ('90000000-0000-0000-0000-000000000005', '2000-01-01'),
  ('90000000-0000-0000-0000-000000000006', '2000-01-01');

INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, status) VALUES
  ('90000000-0000-0000-0000-000000000020', '90000000-0000-0000-0000-000000000001', 'Review Player A', '90000000-0000-0000-0000-000000000005', 'active'),
  -- Archived is a valid existing lifecycle state, not an invalid fixture.
  ('90000000-0000-0000-0000-000000000021', '90000000-0000-0000-0000-000000000001', 'Review Archived Player A', '90000000-0000-0000-0000-000000000006', 'archived'),
  ('90000000-0000-0000-0000-000000000023', '90000000-0000-0000-0000-000000000008', 'Review Academy C Roster', NULL, 'active');

INSERT INTO public.coach_sessions (id, coach_user_id, title) VALUES
  ('90000000-0000-0000-0000-000000000030', '90000000-0000-0000-0000-000000000001', 'Departure review session');
INSERT INTO public.session_attendance (session_id, squad_player_id, status) VALUES
  ('90000000-0000-0000-0000-000000000030', '90000000-0000-0000-0000-000000000020', 'present'),
  ('90000000-0000-0000-0000-000000000030', '90000000-0000-0000-0000-000000000021', 'absent');

-- Positive controls: legitimate current ownership remains usable.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.departure_check(
  (SELECT count(*) = 1 FROM public.squad_players WHERE id = '90000000-0000-0000-0000-000000000020'),
  'CONTROL', 'current coach can read the active academy roster row'
);
SELECT pg_temp.departure_check(
  (SELECT count(*) = 2 FROM public.session_attendance WHERE session_id = '90000000-0000-0000-0000-000000000030'),
  'CONTROL', 'current coach can read the session attendance before departure'
);

-- Trusted incident cleanup retains the owning admin identity. Application
-- departure/transfer assertions below still execute as authenticated users.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000003","role":"service_role"}', true);
SELECT public.remove_coach_from_org('90000000-0000-0000-0000-000000000001');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- F2: departure must cover archived/released records too, not only active.
SELECT pg_temp.departure_check(
  (SELECT count(*) = 0 FROM public.squad_players WHERE id = '90000000-0000-0000-0000-000000000021'),
  'F2', 'removed coach cannot read the former academy archived roster'
);
SELECT pg_temp.departure_expect_denied(
  $$INSERT INTO public.coach_assessments (coach_user_id, squad_player_id) VALUES ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000021')$$,
  'F2', 'removed coach cannot assess the former academy archived player'
);

-- F4: retaining the session diary must not retain child attendance access.
SELECT pg_temp.departure_check(
  (SELECT count(*) = 0 FROM public.session_attendance WHERE session_id = '90000000-0000-0000-0000-000000000030'),
  'F4', 'removed coach cannot read former academy attendance'
);
SELECT pg_temp.departure_expect_denied(
  $$DELETE FROM public.session_attendance WHERE squad_player_id = '90000000-0000-0000-0000-000000000020'$$,
  'F4', 'removed coach cannot delete former academy attendance'
);

-- F5: this is the real SECURITY DEFINER match RPC, not a mocked caller.
SELECT pg_temp.departure_expect_denied(
  $$SELECT public.log_match_for_player('90000000-0000-0000-0000-000000000005', 'Departure review opponent', 1, 0, 'Friendly', 'Home', 'CM', 'Adult', 90, 0, 0, 'none', 'fit', 'good', 6.0, CURRENT_DATE)$$,
  'F5', 'removed coach cannot log a match for the former academy player'
);
RESET ROLE;
SELECT pg_temp.departure_check(
  (SELECT count(*) = 0 FROM public.matches WHERE user_id = '90000000-0000-0000-0000-000000000005'),
  'F5', 'departure-denied match operation leaves no development record'
);

-- F1: after transfer, B must not inherit A's player-profile/DOB access.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- TRAK-12: putting a coach into an academy is an operator step now (Trak
-- moves the coach); this is the same coach_details update join_organization made.
SELECT set_config('trak.saved_claims', current_setting('request.jwt.claims', true), true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.coach_details
SET organization_id = (SELECT id FROM public.organizations WHERE upper(join_code) = upper('REVIEW-B'))
WHERE user_id = (current_setting('trak.saved_claims')::jsonb->>'sub')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', current_setting('trak.saved_claims'), true);
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT pg_temp.departure_check(
  (SELECT count(*) = 0 FROM public.profiles WHERE user_id IN ('90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000006')),
  'F1', 'new academy admin cannot read former academy player profiles'
);
SELECT pg_temp.departure_check(
  (SELECT count(*) = 0 FROM public.player_details WHERE user_id IN ('90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000006')),
  'F1', 'new academy admin cannot read former academy dates of birth'
);
SELECT pg_temp.departure_check(
  (SELECT count(*) = 0 FROM public.squad_players WHERE id IN ('90000000-0000-0000-0000-000000000020', '90000000-0000-0000-0000-000000000021')),
  'CONTROL', 'pinned roster organization already prevents transfer of roster visibility'
);

-- F2 also crosses academy boundaries: current coach org stamps new records.
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.departure_expect_denied(
  $$INSERT INTO public.coach_assessments (coach_user_id, squad_player_id) VALUES ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000021')$$,
  'F2', 'transferred coach cannot assess the former academy archived player'
);
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT pg_temp.departure_check(
  (SELECT count(*) = 0 FROM public.coach_assessments WHERE squad_player_id = '90000000-0000-0000-0000-000000000021'),
  'F2', 'new academy receives no assessment about the former academy archived player'
);

-- F3: possessing a known user UUID must not recreate authority over a child.
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.departure_expect_denied(
  $$INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, status) VALUES ('90000000-0000-0000-0000-000000000022', '90000000-0000-0000-0000-000000000001', 'Unauthorized replacement roster', '90000000-0000-0000-0000-000000000005', 'active')$$,
  'F3', 'removed coach cannot directly recreate a linked roster for the former player'
);
-- Exercise the consequential write only if the unauthorized INSERT succeeded;
-- a denied INSERT must not make the audit fail on an irrelevant missing FK.
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.squad_players WHERE id = '90000000-0000-0000-0000-000000000022') THEN
    PERFORM pg_temp.departure_expect_denied(
      $$INSERT INTO public.coach_assessments (coach_user_id, squad_player_id) VALUES ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000022')$$,
      'F3', 'unauthorized replacement roster cannot authorize assessments'
    );
  END IF;
END;
$test$;

-- F6: use a separate academy with no assessments, isolating the new squad FK.
SELECT set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.delete_my_account();
  EXCEPTION WHEN foreign_key_violation THEN
    -- A committed-fixture prototype left an orphan; with these fixtures in
    -- the same transaction PostgreSQL instead raises the queued FK check.
    -- Neither outcome satisfies successful erasure plus valid references.
    PERFORM pg_temp.departure_check(false, 'F6', 'academy admin deletion must not fail its roster organization foreign key');
  END;
END;
$test$;
RESET ROLE;
SELECT pg_temp.departure_check(
  NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = '90000000-0000-0000-0000-000000000012')
  AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '90000000-0000-0000-0000-000000000007'),
  'F6', 'academy admin deletion completes'
);
SELECT pg_temp.departure_check(
  (SELECT count(*) = 1 FROM public.squad_players WHERE id = '90000000-0000-0000-0000-000000000023' AND organization_id IS NULL),
  'F6', 'academy deletion preserves the roster with organization_id cleared by its SET NULL FK'
);
SELECT pg_temp.departure_check(
  NOT EXISTS (
    SELECT 1 FROM public.squad_players sp
    LEFT JOIN public.organizations o ON o.id = sp.organization_id
    WHERE sp.organization_id IS NOT NULL AND o.id IS NULL
  ),
  'F6', 'no roster organization reference points to a deleted academy'
);

DO $test$
DECLARE
  failed_count integer;
  finding_count integer;
  details text;
BEGIN
  SELECT count(*), count(DISTINCT finding),
         string_agg(finding || ': ' || assertion, E'\n' ORDER BY finding, assertion)
  INTO failed_count, finding_count, details
  FROM pg_temp.departure_review_failures;
  IF failed_count > 0 THEN
    RAISE EXCEPTION E'Coach departure regression: % desired assertions failed across % finding IDs.\n%',
      failed_count, finding_count, details;
  END IF;
END;
$test$;

ROLLBACK;

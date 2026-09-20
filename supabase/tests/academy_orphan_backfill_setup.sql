-- @trak-fixture
-- DISPOSABLE ONLY, immediately before the F1/F6 repair migration.
-- Simulate already-corrupt legacy organization references to verify the data
-- repair UPDATEs. This is not a claim that authenticated users can disable FK
-- triggers. Ordinary legacy deletion failures have separate executable tests.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing orphan backfill fixtures outside disposable harness';
  END IF;
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
CREATE TEMP TABLE academy_orphan_backfill_marker (setup_xid bigint NOT NULL);
INSERT INTO academy_orphan_backfill_marker VALUES (txid_current());
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('93000000-0000-0000-0000-000000000001', 'orphan-admin@test.invalid', now()),
  ('93000000-0000-0000-0000-000000000002', 'orphan-coach@test.invalid', now()),
  ('93000000-0000-0000-0000-000000000003', 'orphan-player@test.invalid', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('93000000-0000-0000-0000-000000000001', 'club', 'Synthetic Backfill Admin'),
  ('93000000-0000-0000-0000-000000000002', 'coach', 'Synthetic Backfill Coach'),
  ('93000000-0000-0000-0000-000000000003', 'player', 'Synthetic Backfill Player');
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES ('93000000-0000-0000-0000-000000000010', '93000000-0000-0000-0000-000000000001', 'Synthetic Backfill Academy', 'BACKFILL-ONLY');
INSERT INTO public.coach_details (user_id, organization_id)
VALUES ('93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000010');
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name) VALUES
  ('93000000-0000-0000-0000-000000000020', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000003', 'Corrupt History'),
  ('93000000-0000-0000-0000-000000000021', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000003', 'Valid History');
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id) VALUES
  ('93000000-0000-0000-0000-000000000030', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000020'),
  ('93000000-0000-0000-0000-000000000031', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000021');
INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type) VALUES
  ('93000000-0000-0000-0000-000000000040', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000020', 'effort'),
  ('93000000-0000-0000-0000-000000000041', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000021', 'effort');

DO $test$
BEGIN
  -- Transaction-local only; the exception handler and transaction rollback
  -- both restore origin if constructing this deliberate corruption fails.
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.squad_players SET organization_id = '93000000-0000-0000-0000-000000000099'
  WHERE id = '93000000-0000-0000-0000-000000000020';
  UPDATE public.coach_assessments SET organization_id = '93000000-0000-0000-0000-000000000099'
  WHERE id = '93000000-0000-0000-0000-000000000030';
  UPDATE public.recognition_awards SET organization_id = '93000000-0000-0000-0000-000000000099'
  WHERE id = '93000000-0000-0000-0000-000000000040';
  PERFORM set_config('session_replication_role', 'origin', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('session_replication_role', 'origin', true);
  RAISE;
END;
$test$;
COMMIT;

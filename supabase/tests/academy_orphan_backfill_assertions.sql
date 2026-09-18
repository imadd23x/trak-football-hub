-- Run directly after the repair migration, then remove every synthetic row.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing orphan assertions outside disposable harness';
  END IF;
  IF current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'Backfill setup did not restore ordinary FK/trigger behavior';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.academy_orphan_backfill_marker WHERE setup_xid <> txid_current()) THEN
    RAISE EXCEPTION 'Orphan fixture must be committed before migration replay';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.squad_players WHERE id = '93000000-0000-0000-0000-000000000020'
      AND organization_id IS NULL AND organization_deleted_at IS NOT NULL AND status = 'coach_departed'
  ) THEN
    RAISE EXCEPTION 'Existing orphan roster was not cleared and permanently closed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = '93000000-0000-0000-0000-000000000030' AND organization_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.recognition_awards WHERE id = '93000000-0000-0000-0000-000000000040' AND organization_id IS NULL) THEN
    RAISE EXCEPTION 'Existing orphan assessment/award references were not cleared';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.squad_players WHERE id = '93000000-0000-0000-0000-000000000021' AND organization_id = '93000000-0000-0000-0000-000000000010' AND organization_deleted_at IS NULL AND status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = '93000000-0000-0000-0000-000000000031' AND organization_id = '93000000-0000-0000-0000-000000000010')
     OR NOT EXISTS (SELECT 1 FROM public.recognition_awards WHERE id = '93000000-0000-0000-0000-000000000041' AND organization_id = '93000000-0000-0000-0000-000000000010') THEN
    RAISE EXCEPTION 'Backfill changed valid academy history';
  END IF;
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', false);
DELETE FROM public.squad_players WHERE id IN ('93000000-0000-0000-0000-000000000020', '93000000-0000-0000-0000-000000000021');
DELETE FROM public.organizations WHERE id = '93000000-0000-0000-0000-000000000010';
DELETE FROM auth.users WHERE id IN ('93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000003');
DROP TABLE pg_temp.academy_orphan_backfill_marker;
COMMIT;

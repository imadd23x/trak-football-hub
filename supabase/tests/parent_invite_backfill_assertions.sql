-- @trak-fixture
-- Run immediately after secure_parent_invites against the setup fixtures.
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to verify migration fixtures outside the disposable test harness';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.parent_invites
    WHERE id='91000000-0000-0000-0000-000000000001'
      AND expires_at=created_at + interval '7 days' AND expires_at < now()
  ) THEN RAISE EXCEPTION 'Backfill must preserve stale invitation expiry'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.parent_invites
    WHERE id='91000000-0000-0000-0000-000000000002'
      AND expires_at=created_at + interval '7 days' AND expires_at > now()
  ) THEN RAISE EXCEPTION 'Backfill must preserve original seven-day window for recent invitation'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.parent_invites
    WHERE id='91000000-0000-0000-0000-000000000003' AND expires_at <= now()
  ) THEN RAISE EXCEPTION 'Unknown invitation creation time must fail closed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.parent_invites
    WHERE id='91000000-0000-0000-0000-000000000004' AND status='accepted'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.player_parent_links
    WHERE player_user_id='90000000-0000-0000-0000-000000000001'
      AND parent_user_id='90000000-0000-0000-0000-000000000002'
  ) THEN RAISE EXCEPTION 'Migration must preserve existing accepted links'; END IF;
  IF has_column_privilege('authenticated', 'public.parent_invites', 'player_user_id', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.parent_invites', 'parent_email', 'INSERT')
    OR has_column_privilege('authenticated', 'public.player_parent_links', 'player_user_id', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.player_parent_links', 'parent_user_id', 'INSERT')
  THEN RAISE EXCEPTION 'Migration must revoke explicit column write privileges'; END IF;
END;
$test$;

-- Fixtures are no longer needed; auth FK cascades remove dependent rows.
DELETE FROM auth.users WHERE id IN (
  '90000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002'
);

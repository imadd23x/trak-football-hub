-- @trak-fixture
-- The disposable runner executes this after the historical migrations and
-- immediately before secure_parent_invites. These are synthetic fixtures.
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to prepare migration fixtures outside the disposable test harness';
  END IF;
END;
$test$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('90000000-0000-0000-0000-000000000001', 'backfill-child@p1.test', now()),
  ('90000000-0000-0000-0000-000000000002', 'backfill-parent@p1.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('90000000-0000-0000-0000-000000000001', 'player', 'Backfill Test Child'),
  ('90000000-0000-0000-0000-000000000002', 'parent', 'Backfill Test Parent');
INSERT INTO public.parent_invites (id, player_user_id, parent_email, status, created_at) VALUES
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'stale@p1.test', 'pending', now() - interval '8 days'),
  ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'recent@p1.test', 'pending', now() - interval '1 day'),
  ('91000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'unknown-date@p1.test', 'pending', NULL),
  ('91000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000001', 'backfill-parent@p1.test', 'accepted', now() - interval '100 days');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
VALUES ('90000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002');

-- Explicit column grants are independent of table grants. The new migration
-- must remove both, even if an old environment has accumulated these grants.
GRANT UPDATE (player_user_id), INSERT (parent_email) ON public.parent_invites TO authenticated;
GRANT INSERT (player_user_id, parent_user_id), UPDATE (player_user_id)
  ON public.player_parent_links TO authenticated;

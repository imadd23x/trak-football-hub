-- @trak-fixture
-- Poison legacy ACLs before the operational-view repair. Everything is inside
-- the disposable database, which the runner destroys after the suite.
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing operational-view backfill fixture outside the disposable test harness';
  END IF;
END;
$test$;
GRANT SELECT (who) ON public.pilot_activation TO PUBLIC, anon, authenticated;
GRANT SELECT (parent_email) ON public.stale_pending_consent TO anon, authenticated;
GRANT UPDATE (created_at) ON public.pilot_time_to_assess TO PUBLIC, anon, authenticated, service_role;
GRANT SELECT (coach_user_id), INSERT (coach_user_id), UPDATE (created_at), REFERENCES (coach_user_id)
  ON public.pilot_rating_agreement TO PUBLIC, anon, authenticated, service_role;

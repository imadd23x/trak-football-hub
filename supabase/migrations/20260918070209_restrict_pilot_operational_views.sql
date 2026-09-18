-- Operational reports belong to the founder/service-role SQL workflow, not
-- the application API. Some are automatically updatable, so SELECT-only
-- revocation would leave a write path around the base-table RLS policies.
-- Keep definitions and report results intact; change only access boundaries.
DO $migration$
DECLARE view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'pilot_activation', 'pilot_match_coverage', 'pilot_assessment_rate',
    'pilot_time_to_assess', 'pilot_rating_agreement', 'pilot_rating_agreement_derived',
    'pilot_weekly_active', 'pilot_retention', 'pilot_safeguarding_checks',
    'pilot_scorecard', 'squad_duplicate_candidates', 'stale_pending_consent'
  ] LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', view_name);
    -- PostgreSQL also revokes corresponding column privileges here. Regression
    -- fixtures include explicit column grants and grants inherited from PUBLIC.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', view_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', view_name);
  END LOOP;
END;
$migration$;

-- Both helpers use built-in operators/functions only and remain invokers.
ALTER FUNCTION public.band_ordinal(text) SET search_path = pg_catalog;
ALTER FUNCTION public.score_to_band(numeric) SET search_path = pg_catalog;

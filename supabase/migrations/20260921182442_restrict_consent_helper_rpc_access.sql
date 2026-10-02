-- Internal predicates accepted arbitrary player/roster UUIDs as public RPCs.
-- Supabase's explicit anon grant survived the historical REVOKE FROM PUBLIC.
-- Keep their math, UTC configuration and owner-level callers unchanged; app
-- clients use my_consent_status/get_children_awaiting_consent instead.
--
-- RLS runs as authenticated, so revoking the squad helper alone would break
-- five policies. A qualified helper in an unexposed schema gives those policies
-- the same predicate without another public RPC. Do not add trak_private to
-- PostgREST's exposed schemas or extra search path. Verify the hosted API
-- configuration separately before claiming this release closes HTTP access.
--
-- Rollback is a forward repair of the bridge/policies, never a regrant of the
-- arbitrary-ID public RPCs. No user rows or consent decisions are changed.

CREATE SCHEMA IF NOT EXISTS trak_private;
REVOKE ALL ON SCHEMA trak_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA trak_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION trak_private.squad_player_consent_required(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT public.squad_player_consent_required(p_squad_player_id);
$fn$;
REVOKE ALL ON FUNCTION trak_private.squad_player_consent_required(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.squad_player_consent_required(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION trak_private.squad_player_consent_required(uuid) IS
  'RLS-only bridge to the internal consent predicate; keep trak_private outside exposed API schemas.';

REVOKE EXECUTE ON FUNCTION public.player_age_years(uuid),
  public.player_has_parental_consent(uuid), public.player_consent_required(uuid),
  public.squad_player_consent_required(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.player_age_years(uuid),
  public.player_has_parental_consent(uuid), public.player_consent_required(uuid),
  public.squad_player_consent_required(uuid) TO service_role;

-- #94's coach UI needs the consent boolean for its current roster, not a
-- public predicate over any child's UUID. Reuse exactly the ownership/academy
-- checks already required by assessment/award inserts before reading consent.
CREATE OR REPLACE FUNCTION public.coach_squad_player_consent_required(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_coach()
     OR NOT public.squad_player_is_mine(p_squad_player_id) THEN
    RAISE EXCEPTION 'Not authorized for this squad player' USING ERRCODE = '42501';
  END IF;
  RETURN public.squad_player_consent_required(p_squad_player_id);
END;
$fn$;
-- Supabase may give service_role an explicit default grant too. This is an app
-- endpoint; service callers retain the four internal functions above instead.
REVOKE ALL ON FUNCTION public.coach_squad_player_consent_required(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coach_squad_player_consent_required(uuid) TO authenticated;
COMMENT ON FUNCTION public.coach_squad_player_consent_required(uuid) IS
  'Consent gate for the signed-in coach''s current roster; foreign and missing IDs return the same authorization error.';

-- Only the qualified helper changes. Ownership, organization, publication and
-- withdrawal conditions remain those of the currently deployed policies.
ALTER POLICY "Coaches can insert assessments" ON public.coach_assessments
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
    AND (session_id IS NULL OR public.coach_session_is_mine(session_id))
    AND organization_id IS NOT DISTINCT FROM public.my_coach_organization_id()
    AND NOT trak_private.squad_player_consent_required(squad_player_id)
  );

ALTER POLICY "Coaches can insert awards" ON public.recognition_awards
  WITH CHECK (
    coach_user_id = auth.uid()
    AND public.is_coach()
    AND public.squad_player_is_mine(squad_player_id)
    AND organization_id IS NOT DISTINCT FROM public.my_coach_organization_id()
    AND NOT trak_private.squad_player_consent_required(squad_player_id)
  );

ALTER POLICY "Players read their own current feedback" ON public.player_feedback
  USING (
    superseded_at IS NULL
    AND NOT trak_private.squad_player_consent_required(squad_player_id)
    AND EXISTS (
      SELECT 1 FROM public.squad_players sp
      WHERE sp.id = player_feedback.squad_player_id
        AND sp.linked_player_id = auth.uid()
    )
  );

ALTER POLICY "Players read published feedback for their assessments" ON public.coach_shared_feedback
  USING (
    published_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      JOIN public.squad_players sp ON sp.id = ca.squad_player_id
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND sp.linked_player_id = auth.uid()
        AND NOT trak_private.squad_player_consent_required(sp.id)
    )
  );

ALTER POLICY "Parents read published feedback for their children" ON public.coach_shared_feedback
  USING (
    published_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      JOIN public.squad_players sp ON sp.id = ca.squad_player_id
      JOIN public.player_parent_links l ON l.player_user_id = sp.linked_player_id
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND l.parent_user_id = auth.uid()
        AND NOT trak_private.squad_player_consent_required(sp.id)
    )
  );

DO $migration$
DECLARE helper regprocedure;
BEGIN
  FOREACH helper IN ARRAY ARRAY[
    'public.player_age_years(uuid)'::regprocedure,
    'public.player_has_parental_consent(uuid)'::regprocedure,
    'public.player_consent_required(uuid)'::regprocedure,
    'public.squad_player_consent_required(uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', helper, 'EXECUTE')
       OR has_function_privilege('authenticated', helper, 'EXECUTE')
       OR NOT has_function_privilege('service_role', helper, 'EXECUTE') THEN
      RAISE EXCEPTION 'Incorrect internal helper privileges: %', helper;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_depend
      WHERE classid = 'pg_policy'::regclass AND refclassid = 'pg_proc'::regclass
        AND refobjid = helper::oid) THEN
      RAISE EXCEPTION 'An RLS policy still calls public helper %', helper;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT objid) FROM pg_depend
      WHERE classid = 'pg_policy'::regclass AND refclassid = 'pg_proc'::regclass
        AND refobjid = 'trak_private.squad_player_consent_required(uuid)'::regprocedure) <> 5 THEN
    RAISE EXCEPTION 'Expected all five consent policies to call the private bridge';
  END IF;
  IF has_function_privilege('anon', 'public.coach_squad_player_consent_required(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.coach_squad_player_consent_required(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.coach_squad_player_consent_required(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Incorrect scoped coach RPC privileges';
  END IF;
  IF has_schema_privilege('anon', 'trak_private', 'USAGE')
     OR has_schema_privilege('authenticated', 'trak_private', 'CREATE')
     OR has_function_privilege('anon', 'trak_private.squad_player_consent_required(uuid)', 'EXECUTE')
     OR NOT has_schema_privilege('authenticated', 'trak_private', 'USAGE')
     OR NOT has_function_privilege('authenticated', 'trak_private.squad_player_consent_required(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Incorrect private RLS bridge privileges';
  END IF;
END;
$migration$;

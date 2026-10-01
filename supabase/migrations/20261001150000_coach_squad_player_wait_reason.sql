-- TRAK-99 (J5): the squad told a coach to wait for a parent who had already
-- said yes. squad_player_consent_required() is true while linked_player_id is
-- null, so a roster child whose guardian has approved but who hasn't signed up
-- yet looked exactly like a child with no approval.
--
-- This only says WHY a player can't be assessed yet. It changes no policy:
-- every write is still refused by the same squad_player_consent_required()
-- check as before.
--
--   'ready'   the policies allow an assessment now
--   'signup'  an active roster consent exists; the child has no account yet
--   'parent'  anything else (no consent yet, or it was withdrawn)
CREATE FUNCTION public.coach_squad_player_wait_reason(p_squad_player_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- The same gate as coach_squad_player_consent_required: foreign and missing
  -- IDs get the same error, so this can't be used to probe other squads.
  IF auth.uid() IS NULL
     OR NOT public.is_coach()
     OR NOT public.squad_player_is_mine(p_squad_player_id) THEN
    RAISE EXCEPTION 'Not authorized for this squad player' USING ERRCODE = '42501';
  END IF;
  IF NOT public.squad_player_consent_required(p_squad_player_id) THEN
    RETURN 'ready';
  END IF;
  -- The consent the guardian gave before the child had an account
  -- (record_roster_consent), read exactly as get_roster_children_awaiting_consent does.
  IF EXISTS (
    SELECT 1
    FROM public.squad_players sp
    JOIN public.roster_children rc ON rc.squad_player_id = sp.id
    JOIN public.parental_consents c ON c.roster_child_id = rc.id
    WHERE sp.id = p_squad_player_id
      AND sp.linked_player_id IS NULL
      AND c.withdrawn_at IS NULL
      AND c.superseded_by IS NULL
      AND c.purposes->'coaching_records' = 'true'::jsonb
  ) THEN
    RETURN 'signup';
  END IF;
  RETURN 'parent';
END;
$fn$;

REVOKE ALL ON FUNCTION public.coach_squad_player_wait_reason(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coach_squad_player_wait_reason(uuid) TO authenticated;
COMMENT ON FUNCTION public.coach_squad_player_wait_reason(uuid) IS
  'TRAK-99: ready / signup / parent for the signed-in coach''s current roster. Display only; the policies still gate every write.';

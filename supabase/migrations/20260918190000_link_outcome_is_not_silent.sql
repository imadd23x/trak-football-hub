-- T4 — a player who joins must never silently lose their history.
--
-- link_player_to_coach() adopts the coach's existing roster row only when the
-- player's profile name matches exactly one unlinked row, case-insensitively.
-- Anything else falls through to INSERT a fresh row. Proven by
-- supabase/tests/roster_adoption.sql, 3 of 6 assertions failing on main:
--
--   a one-letter misspelling -> 0 assessments on the row the player landed on
--   the coach's original row -> left orphaned, still holding the history
--   two players named alike  -> two unlinked rows plus a third new one
--
-- The coach types "Mohammad", the player registers "Mohammed", and the player
-- gets an empty record while the coach's row keeps both assessments, linked to
-- nobody. Nothing errors. The player assumes the empty record is correct.
--
-- What this migration does NOT do, deliberately: guess. Fuzzy-matching
-- children by name would sometimes adopt the wrong child's assessment history,
-- which is worse than losing it. The fix is to stop the failure being silent,
-- not to make the guess cleverer.
--
-- The existing function keeps its exact signature and behaviour, so every
-- caller — including provision_my_profile — is untouched. This adds a second,
-- read-only function the client calls after linking, to ask what actually
-- happened.

CREATE OR REPLACE FUNCTION public.my_link_outcome(p_squad_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_coach       uuid;
  v_assessments integer;
  v_unlinked    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only ever about the caller's own roster row. A player cannot ask this
  -- question about anybody else, which is why it can be SECURITY DEFINER.
  SELECT coach_user_id INTO v_coach
  FROM public.squad_players
  WHERE id = p_squad_player_id AND linked_player_id = v_uid;

  IF v_coach IS NULL THEN
    RETURN jsonb_build_object('linked', false);
  END IF;

  SELECT count(*) INTO v_assessments
  FROM public.coach_assessments
  WHERE squad_player_id = p_squad_player_id;

  -- Rows this coach created that nobody has claimed. If the player landed on a
  -- fresh row with no history while the coach still has unclaimed rows, the
  -- most likely explanation is a spelling difference — but which row is theirs
  -- is not ours to decide, so we report the situation rather than resolve it.
  SELECT count(*) INTO v_unlinked
  FROM public.squad_players
  WHERE coach_user_id = v_coach
    AND linked_player_id IS NULL
    AND status <> 'coach_departed';

  RETURN jsonb_build_object(
    'linked', true,
    'assessments', v_assessments,
    'coach_has_unclaimed_rows', v_unlinked,
    -- The client shows a warning on this alone. It is deliberately not a
    -- guess about which row, only that there is something to ask the coach.
    'may_have_missed_history', v_assessments = 0 AND v_unlinked > 0
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.my_link_outcome(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.my_link_outcome(uuid) TO authenticated;

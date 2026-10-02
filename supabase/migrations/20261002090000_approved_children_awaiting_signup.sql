-- TRAK-98 (G6): a guardian can't see or withdraw a child they approved who
-- hasn't signed up yet. In the 1 Oct TRAK-24 run Guardian A approved both
-- siblings; Sibling Two never signed up, so Home only ever showed Sibling One
-- and Profile offered no way to withdraw Sibling Two. The parent's child list
-- is player_parent_links, which only exists once the child has an account.
--
-- This is the missing read: the caller's own live roster consents for a child
-- with no account yet. Withdrawal already exists (withdraw_roster_consent,
-- 20260927090000), and a consent withdrawn before sign-up is carried onto the
-- child's account still withdrawn (roster_consent_follows_claim), so the child
-- can sign up but no coach can record about them.
--
-- Only the caller's own consents: withdraw_roster_consent withdraws only the
-- caller's, so listing another guardian's approval would offer a withdrawal
-- that does nothing. First names only, like get_roster_children_awaiting_consent.
CREATE FUNCTION public.get_my_approved_children_awaiting_signup()
RETURNS TABLE (roster_child_id uuid, first_name text, approved_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT rc.id,
         split_part(btrim(sp.player_name), ' ', 1),
         c.granted_at
  FROM public.parental_consents c
  JOIN public.roster_children rc ON rc.id = c.roster_child_id
  JOIN public.squad_players sp   ON sp.id = rc.squad_player_id
  WHERE c.parent_user_id = auth.uid()
    AND c.withdrawn_at IS NULL
    AND c.superseded_by IS NULL
    AND c.purposes->'coaching_records' = 'true'::jsonb
    AND rc.player_user_id IS NULL
    AND EXISTS (SELECT 1 FROM public.roster_guardians rg
                WHERE rg.roster_child_id = rc.id AND rg.parent_user_id = auth.uid())
  ORDER BY 2, 1;
$fn$;

REVOKE ALL ON FUNCTION public.get_my_approved_children_awaiting_signup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_approved_children_awaiting_signup() TO authenticated;
COMMENT ON FUNCTION public.get_my_approved_children_awaiting_signup() IS
  'TRAK-98: the caller''s own live roster consents for a child with no account yet. First names only.';

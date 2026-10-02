-- TRAK-91 (J1/J2), Imad's decision of 1 Oct: "never re-send" becomes opt-in on
-- the server, not a blanket filter.
--
-- The operator path of roster_invite_targets() picks every guardian with
-- parent_user_id IS NULL, already invited or not. So `load-roster --reinvite`
-- for a family with one invited and one uninvited guardian emailed both. A
-- blanket invited_at IS NULL filter would remove every way to resend an
-- expired link, so it is a third, opt-in argument instead:
--   p_only_uninvited = false (default): exactly as before;
--   p_only_uninvited = true: only targets never invited (invited_at IS NULL).
-- send-roster-invites accepts it from the operator only; --reinvite sends it.
--
-- Built on 20260930090127 (TRAK-84), which made roster_invite_targets a filter
-- over roster_email_invite_targets that leaves out @child.trakfootball.com logins.
DROP FUNCTION public.roster_invite_targets(uuid, uuid);

CREATE FUNCTION public.roster_invite_targets(
  p_roster_child_id uuid,
  p_guardian_user_id uuid DEFAULT NULL,
  p_only_uninvited boolean DEFAULT false
)
RETURNS TABLE(kind text, email text, first_name text, academy text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT t.kind, t.email, t.first_name, t.academy
 FROM public.roster_email_invite_targets(p_roster_child_id, p_guardian_user_id) t
 WHERE lower(split_part(t.email, '@', 2)) <> 'child.trakfootball.com'
   AND (NOT coalesce(p_only_uninvited, false)
     OR (t.kind = 'guardian' AND EXISTS (
           SELECT 1 FROM public.roster_guardians rg
           WHERE rg.roster_child_id = p_roster_child_id AND rg.email = t.email AND rg.invited_at IS NULL))
     OR (t.kind = 'child' AND EXISTS (
           SELECT 1 FROM public.roster_children rc
           WHERE rc.id = p_roster_child_id AND rc.invited_at IS NULL)))
$$;
REVOKE ALL ON FUNCTION public.roster_invite_targets(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_invite_targets(uuid, uuid, boolean) TO service_role;

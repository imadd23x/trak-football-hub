-- TRAK-103 follow-up (Kostas's review of #225, P3 1): show the child their
-- roster name at setup, so a wrong name is spotted on day one rather than
-- after the coach and the family have used it.
--
-- my_roster_name(): the caller's own roster name (squad_players.player_name)
-- through trak_private.roster_player_name, which matches the claimed roster
-- row or, before the claim, the unclaimed row for the caller's confirmed
-- email. NULL for anyone who isn't a rostered child. Only ever the caller's
-- own name; signed-in users only.
CREATE FUNCTION public.my_roster_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE trak_private.roster_player_name(auth.uid()) END
$fn$;

REVOKE ALL ON FUNCTION public.my_roster_name() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_roster_name() TO authenticated;
COMMENT ON FUNCTION public.my_roster_name() IS
  'TRAK-103: the caller''s own roster name, shown at setup. NULL when the caller is not a rostered child.';

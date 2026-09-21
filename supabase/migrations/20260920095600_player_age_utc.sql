-- Calendar birthdays must use the same UTC date as the client helper. Pin the
-- function's execution timezone so current_date cannot change with its caller.
-- ALTER preserves its body, stable/definer contract, owner, signature and ACLs.
-- This does not change the consent threshold or implement academy consent.
ALTER FUNCTION public.player_age_years(uuid) SET TimeZone = 'UTC';

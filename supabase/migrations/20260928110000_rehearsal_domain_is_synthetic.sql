-- TRAK-89: the rehearsal accounts move from @rehearsal.trak.dev, a domain we
-- don't own, to @rehearsal.trakfootball.com (ours; nothing under it accepts
-- mail). J7 recognises synthetic accounts by domain (20260926130000), so the
-- new one must count as synthetic before any account moves, or every
-- rehearsal account would be reported as a real pilot user. Only this
-- subdomain: trakfootball.com itself (support, founders) is real. trak.dev
-- stays for the local dev seeds.
CREATE OR REPLACE FUNCTION public.pilot_synthetic_user_ids()
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM auth.users u
  CROSS JOIN LATERAL (SELECT lower(split_part(u.email, '@', 2)) AS d) e
  WHERE e.d = 'rehearsal.trakfootball.com'
     OR e.d = 'trak.dev' OR e.d LIKE '%.trak.dev'
     OR e.d IN ('example.com', 'example.org', 'example.net')
     OR e.d LIKE '%.example' OR e.d LIKE '%.test'
     OR e.d LIKE '%.invalid' OR e.d LIKE '%.localhost';
$$;

COMMENT ON FUNCTION public.pilot_synthetic_user_ids() IS
  'Accounts on synthetic or reserved test domains (incl. rehearsal.trakfootball.com). J7 reports exclude them unless pilot_config.count_synthetic.';

REVOKE ALL ON FUNCTION public.pilot_synthetic_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_synthetic_user_ids() TO service_role;

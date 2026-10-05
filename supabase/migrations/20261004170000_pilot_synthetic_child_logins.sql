-- TRAK-108 (J7): a username child (TRAK-84) is as synthetic as the guardian
-- who made the login. The login's internal @child.trakfootball.com address is
-- no test domain, so a rehearsal family's child counted as a real child
-- (TRAK-24 run 4, 4 Oct: three children of .test guardians).
-- One rule is added. The domain rules are unchanged from 20260926130000.
CREATE OR REPLACE FUNCTION public.pilot_synthetic_user_ids()
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH by_domain AS (
    SELECT u.id
    FROM auth.users u
    CROSS JOIN LATERAL (SELECT lower(split_part(u.email, '@', 2)) AS d) e
    WHERE e.d = 'trak.dev' OR e.d LIKE '%.trak.dev'
       OR e.d IN ('example.com', 'example.org', 'example.net')
       OR e.d LIKE '%.example' OR e.d LIKE '%.test'
       OR e.d LIKE '%.invalid' OR e.d LIKE '%.localhost'
  )
  SELECT id FROM by_domain
  UNION
  SELECT cl.auth_user_id
  FROM public.child_logins cl
  WHERE cl.auth_user_id IS NOT NULL
    AND cl.created_by IN (SELECT id FROM by_domain);
$$;

COMMENT ON FUNCTION public.pilot_synthetic_user_ids() IS
  'Accounts on synthetic or reserved test domains, plus username children whose login a synthetic guardian made. J7 reports exclude them unless pilot_config.count_synthetic.';

REVOKE ALL ON FUNCTION public.pilot_synthetic_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_synthetic_user_ids() TO service_role;

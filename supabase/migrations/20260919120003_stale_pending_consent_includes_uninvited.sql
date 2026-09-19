-- ============================================================
-- The stale-consent report must see children whose parent was never invited
--
-- 20260912000001's stale_pending_consent view filters on
--   COALESCE(pi.created_at, now()) < now() - interval '30 days'
-- For an under-age player with no parent_invites row at all, that collapses
-- to now() < now() - 30 days, which is never true. The report is blind to
-- the worst case it exists to catch: a child who needs consent and has no
-- parent anywhere in the loop. Verified against the live project on
-- 2026-09-19: one such child exists and the view returns zero rows for them.
--
-- Secondary defect: the LEFT JOIN is unaggregated, so a child with several
-- invites appears once per invite.
--
-- What this does:
--   * Measures the 30 days from the most recent invite, or from account
--     creation when there has never been one. "Stale" keeps its meaning —
--     a child invited yesterday, or created yesterday, is not stale.
--   * Joins the latest invite only, so the report has one row per child.
--   * Same columns in the same order, so CREATE OR REPLACE VIEW applies and
--     every existing grant is preserved. invited_at and waiting_for are NULL
--     for the never-invited case; that null is the finding.
--
-- 20260918070209 set security_invoker and restricted this view to
-- service_role SELECT. Both survive CREATE OR REPLACE VIEW; both are
-- re-applied below regardless, so this file does not depend on that.
-- ============================================================

CREATE OR REPLACE VIEW public.stale_pending_consent AS
SELECT pd.user_id                           AS player_user_id,
       p.full_name,
       public.player_age_years(pd.user_id)  AS age_years,
       latest.parent_email,
       latest.created_at                    AS invited_at,
       now() - latest.created_at            AS waiting_for
FROM public.player_details pd
JOIN public.profiles p ON p.user_id = pd.user_id
LEFT JOIN LATERAL (
  SELECT pi.parent_email, pi.created_at
  FROM public.parent_invites pi
  WHERE pi.player_user_id = pd.user_id
  ORDER BY pi.created_at DESC
  LIMIT 1
) latest ON true
WHERE public.player_consent_required(pd.user_id)
  AND COALESCE(latest.created_at, p.created_at) < now() - interval '30 days';

COMMENT ON VIEW public.stale_pending_consent IS
  'Under-age players whose parent has not authorised within 30 days of the latest invite, or of account creation if no parent was ever invited. Review and erase via delete_my_account or an admin path; do not leave indefinitely.';

ALTER VIEW public.stale_pending_consent SET (security_invoker = true);
REVOKE ALL ON TABLE public.stale_pending_consent FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.stale_pending_consent TO service_role;


-- ── Post-conditions ──────────────────────────────────────────
DO $migration$
BEGIN
  IF NOT (SELECT c.reloptions @> ARRAY['security_invoker=true']
          FROM pg_class c WHERE c.oid = 'public.stale_pending_consent'::regclass) THEN
    RAISE EXCEPTION 'stale_pending_consent lost security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.stale_pending_consent', 'SELECT')
     OR has_table_privilege('authenticated', 'public.stale_pending_consent', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.stale_pending_consent', 'SELECT') THEN
    RAISE EXCEPTION 'stale_pending_consent grants changed';
  END IF;
  IF pg_get_viewdef('public.stale_pending_consent'::regclass) NOT LIKE '%p.created_at%' THEN
    RAISE EXCEPTION 'stale_pending_consent does not fall back to account creation';
  END IF;
END;
$migration$;

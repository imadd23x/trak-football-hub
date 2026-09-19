-- ============================================================
-- Revoke destructive and unused table privileges from the app roles
--
-- Supabase's exposed-schema defaults grant every table privilege to `anon`
-- and `authenticated` — SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER and (PostgreSQL 17) MAINTAIN. Row-level security governs the first
-- four. It does not apply to TRUNCATE at all: TRUNCATE is a table-level
-- operation that never evaluates a policy. Verified against the live project
-- on 2026-09-19: 18 of 21 public tables granted all eight privileges to both
-- roles, and the anon key is public by design (it ships in the browser
-- bundle). That is an unauthenticated, one-request, whole-table data-loss
-- capability on children's records.
--
-- What this does:
--   1. Revokes every table privilege from PUBLIC, anon and authenticated on
--      every table in `public`. `REVOKE ALL` rather than a listed set, so
--      MAINTAIN is included — 20260917205027 listed six privileges by name
--      and left MAINTAIN behind on both tables it hardened.
--   2. Re-grants `authenticated` exactly the operations a row-level policy
--      backs. A grant with no policy can never succeed and is pure surface;
--      a policy with no grant can never run. The post-condition below fails
--      the migration if the two disagree, so a wrong line here aborts rather
--      than shipping a broken journey.
--   3. Revokes the *default* privileges, so the next `CREATE TABLE` is not
--      born open. Without this, step 1 is a snapshot that the next migration
--      silently undoes. New tables must now grant explicitly — which
--      20260918000002, and every open PR that creates a table, already do.
--
-- What this does not touch:
--   * `anon` keeps nothing. Every policy in `public` is scoped to
--     `authenticated`; sign-in, sign-up and invite redemption run through the
--     `auth` schema and SECURITY DEFINER RPCs, neither of which consults the
--     caller's table grants. Verified 2026-09-19: no policy names anon.
--   * `service_role` is unchanged. It holds BYPASSRLS and is the operator path.
--   * Views. 20260918070209 already restricted them to service_role SELECT.
--   * Function EXECUTE grants, sequences, and the `supabase_admin` default
--     ACL entry (that role's defaults need its membership to alter; migration
--     tables are created by the migration role, so its own defaults are what
--     matter). Follow-ups, not this change.
--
-- Rollback: re-run the Supabase default grant for any table that needs it —
--   GRANT ALL ON TABLE public.<name> TO anon, authenticated;
-- No data is modified.
-- ============================================================

-- ── 1. Revoke everything from the app roles on every table ────
DO $migration$
DECLARE t regclass;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END;
$migration$;


-- ── 2. Re-grant exactly what a policy backs ──────────────────
-- Derived from the live policy set on 2026-09-19 and re-verified by the
-- post-condition in section 4 against whatever policies exist at apply time.

-- SELECT, INSERT, UPDATE, DELETE policies all exist.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.admin_notes,
  public.coach_assessment_notes,   -- DELETE policy is USING (false); grant kept so the outcome stays "0 rows", not "permission denied"
  public.coach_assessments,
  public.coach_calendar_events,
  public.coach_sessions,
  public.matches,
  public.meeting_requests,         -- FOR ALL policy
  public.recognition_awards,
  public.session_attendance,
  public.squad_players,
  public.staff_compliance
TO authenticated;

-- No DELETE policy: account removal runs through delete_my_account().
GRANT SELECT, INSERT, UPDATE ON TABLE
  public.coach_details,
  public.organizations,
  public.player_details,
  public.profiles
TO authenticated;

-- Read-only to the app; writes go through SECURITY DEFINER RPCs.
GRANT SELECT ON TABLE
  public.ai_usage_daily,
  public.parental_consents,
  public.player_parent_links
TO authenticated;

-- Append-only; nothing reads it back through the app.
GRANT INSERT ON TABLE public.telemetry_events TO authenticated;

-- parent_invites and pilot_config: no grant. Both have RLS enabled with zero
-- policies, so every direct access was already denied; access is via RPC.


-- ── 3. Close the source: default privileges for new tables ────
-- Applies to tables the migration role creates from now on. If the runner is
-- not `postgres` but can act for it, also close that entry, because the
-- dashboard and older migrations created tables as postgres.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

DO $migration$
BEGIN
  IF current_user <> 'postgres'
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     AND pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
  END IF;
END;
$migration$;


-- ── 4. Post-conditions: abort rather than ship a partial state ─
DO $migration$
DECLARE
  t          regclass;
  tname      text;
  v_cmd      text;
  granted    boolean;
  backed     boolean;
  problems   text := '';
  open_defaults int;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    tname := t::text;

    -- anon holds nothing, and the destructive/DDL-adjacent privileges are gone for everyone.
    IF has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      problems := problems || format(E'\n  anon still holds a privilege on %s', tname);
    END IF;
    IF has_table_privilege('authenticated', t, 'TRUNCATE,REFERENCES,TRIGGER') THEN
      problems := problems || format(E'\n  authenticated still holds TRUNCATE/REFERENCES/TRIGGER on %s', tname);
    END IF;

    -- Every DML grant to authenticated is backed by a policy, and vice versa.
    FOREACH v_cmd IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      granted := has_table_privilege('authenticated', t, v_cmd);
      backed  := EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = (SELECT relname FROM pg_class WHERE oid = t)
          AND (p.cmd = v_cmd OR p.cmd IN ('ALL', '*'))
          AND (p.roles && ARRAY['authenticated', 'public']::name[])
      );
      IF granted AND NOT backed THEN
        problems := problems || format(E'\n  %s granted to authenticated on %s but no policy backs it', v_cmd, tname);
      ELSIF backed AND NOT granted THEN
        problems := problems || format(E'\n  policy exists for %s on %s but authenticated has no grant', v_cmd, tname);
      END IF;
    END LOOP;
  END LOOP;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Privilege post-condition failed:%', problems;
  END IF;

  -- Default privileges: warn rather than abort. The table revokes above are
  -- the live fix; this is what keeps it fixed, and it may need an admin.
  SELECT count(*) INTO open_defaults
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  JOIN pg_roles r ON r.oid = d.defaclrole
  WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
    AND r.rolname IN (current_user, 'postgres')
    AND EXISTS (
      SELECT 1 FROM aclexplode(d.defaclacl) a
      JOIN pg_roles g ON g.oid = a.grantee
      WHERE g.rolname IN ('anon', 'authenticated')
    );
  IF open_defaults > 0 THEN
    RAISE WARNING 'Default table privileges for anon/authenticated remain on % entry(ies) in schema public; run ALTER DEFAULT PRIVILEGES FOR ROLE postgres as an administrator', open_defaults;
  END IF;
END;
$migration$;

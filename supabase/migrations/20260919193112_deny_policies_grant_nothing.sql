-- ============================================================
-- A policy that can never permit a row must not produce a grant
--
-- 20260919120001 derives `authenticated`'s table grants from pg_policies:
-- an operation is granted when a policy exists for it. That rule is too
-- blunt. A `USING (false)` policy is a *denial* — "this table is append-only"
-- — and deriving a grant from it leaves the policy as the single barrier
-- between a user and the rows it was written to protect.
--
-- Three tables on production are affected, all append-only by design, all
-- holding a child's record (verified 2026-09-19):
--
--   coach_assessment_notes   "No assessment note deletion"   DELETE, USING (false)
--   coach_assessments        "No assessment deletion"        DELETE, USING (false)
--   recognition_awards       "No award deletion"             DELETE, USING (false)
--
-- Each currently grants DELETE to `authenticated`. The policy does deny, so
-- nothing is exploitable today — a delete affects 0 rows. But a child's
-- assessment history should not be one policy edit away from removable, and
-- the grant buys nothing: no code path deletes from these tables. The only
-- two `.delete()` call sites in `src/` are `session_attendance` and
-- `coach_calendar_events`, neither of which carries a deny policy.
-- `delete_my_account()` is SECURITY DEFINER and runs as its owner, so the
-- caller's grants are not consulted — GDPR erasure is unaffected.
--
-- Found by Kostas's K9 suite in PR #44, which asserts that `authenticated`
-- must not hold DELETE on `coach_shared_feedback`. That table has the same
-- shape: he grants SELECT, INSERT, UPDATE deliberately and omits DELETE, and
-- 20260919120001's rule would have handed it back. Fixing the rule rather
-- than the table, so the next append-only table is right by construction.
--
-- Effect: DELETE revoked from `authenticated` on the three tables above.
-- Grant totals go from SELECT 18 / INSERT 16 / UPDATE 15 / DELETE 11
-- to DELETE 8; the other three are unchanged. No data is modified.
--
-- Rollback: GRANT DELETE ON TABLE <name> TO authenticated.
-- ============================================================

-- ── 1. Re-derive, excluding policies that can never permit ────
-- Same loop as 20260919120001 section 2, with the added condition. Revoking
-- first keeps this idempotent and lets it correct a table in either
-- direction, so a replay in any order converges on the same state.
DO $migration$
DECLARE
  t    regclass;
  cmds text;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', t);

    SELECT string_agg(DISTINCT operation, ', ')
    INTO cmds
    FROM (
      SELECT unnest(CASE WHEN p.cmd IN ('ALL', '*')
                         THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
                         ELSE ARRAY[p.cmd] END) AS operation
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = (SELECT relname FROM pg_class WHERE oid = t)
        AND p.roles && ARRAY['authenticated', 'public']::name[]
        -- A policy whose USING or WITH CHECK is the false literal can never
        -- admit a row. It states a prohibition; it does not enable an
        -- operation, so it must not produce a grant.
        AND coalesce(p.qual, 'true')       NOT IN ('false', '(false)')
        AND coalesce(p.with_check, 'true') NOT IN ('false', '(false)')
    ) expanded
    WHERE operation IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

    IF cmds IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE %s TO authenticated', cmds, t);
    END IF;
  END LOOP;
END;
$migration$;


-- ── 2. Post-conditions ───────────────────────────────────────
DO $migration$
DECLARE
  problems text := '';
  r        record;
BEGIN
  -- No grant may rest on a deny-only policy.
  FOR r IN
    SELECT DISTINCT p.tablename, p.cmd
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      AND (coalesce(p.qual, '') IN ('false', '(false)')
        OR coalesce(p.with_check, '') IN ('false', '(false)'))
      AND NOT EXISTS (
        -- another policy for the same operation that can permit
        SELECT 1 FROM pg_policies q
        WHERE q.schemaname = p.schemaname AND q.tablename = p.tablename
          AND (q.cmd = p.cmd OR q.cmd IN ('ALL', '*'))
          AND q.roles && ARRAY['authenticated', 'public']::name[]
          AND coalesce(q.qual, 'true')       NOT IN ('false', '(false)')
          AND coalesce(q.with_check, 'true') NOT IN ('false', '(false)')
      )
      AND has_table_privilege('authenticated', ('public.' || p.tablename)::regclass, p.cmd)
  LOOP
    problems := problems || format(E'\n  %s still grants %s to authenticated behind a deny-only policy', r.tablename, r.cmd);
  END LOOP;

  -- The three known tables, named so a silent no-op cannot pass.
  FOR r IN
    SELECT unnest(ARRAY['coach_assessment_notes', 'coach_assessments', 'recognition_awards']) AS tablename
  LOOP
    IF to_regclass('public.' || r.tablename) IS NOT NULL
       AND has_table_privilege('authenticated', ('public.' || r.tablename)::regclass, 'DELETE') THEN
      problems := problems || format(E'\n  %s still grants DELETE to authenticated', r.tablename);
    END IF;
  END LOOP;

  -- And the journeys that do delete must still be able to.
  FOR r IN
    SELECT unnest(ARRAY['session_attendance', 'coach_calendar_events']) AS tablename
  LOOP
    IF NOT has_table_privilege('authenticated', ('public.' || r.tablename)::regclass, 'DELETE') THEN
      problems := problems || format(E'\n  %s LOST its DELETE grant; a real journey deletes from it', r.tablename);
    END IF;
  END LOOP;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Deny-policy grant post-condition failed:%', problems;
  END IF;
END;
$migration$;

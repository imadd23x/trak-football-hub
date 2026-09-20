-- ============================================================
-- Two histories that disagreed, made to agree again
--
-- 20260919170000 dropped "No shared feedback deletion" from
-- coach_shared_feedback. Its reasoning was sound at the time: 20260919120001
-- (#62) derived grants from "does a policy exist for this operation", so a
-- FOR DELETE ... USING (false) policy manufactured the very DELETE grant it
-- was written to forbid. Removing the policy removed the grant with it.
--
-- @imadd23x then fixed that at the source in 20260919193112 (#68): a policy
-- whose qualifier is the false literal is excluded from derivation. The
-- policy became harmless, so dropping it was no longer necessary — and the
-- better shape is the one his A1c asserts on every append-only table, the
-- PAIR: no DELETE grant AND a standing no-deletion policy. Two barriers, not
-- one.
--
-- ── What actually went wrong, which is not the policy
--
-- I first deleted 20260919170000 outright. That broke this PR's Supabase
-- preview, which had already recorded the version:
--
--   Supabase Preview — Remote migration versions not found in local
--   migrations directory.
--
-- I then replaced its body with a no-op tombstone. The preview went green and
-- I reported the matter closed. It was not closed: a tombstone stops a
-- database complaining about a version it holds, and does nothing whatever
-- about the changes that version already made. @imadd23x said so on the plan
-- — "restore historical bytes and add a forward repair; prove fresh and
-- already-applied preview histories converge; do not reset a database to
-- conceal the difference" — and measuring it read-only against the preview
-- (project dghdhmskyzrkjtivkubi) proved him right:
--
--   v170000_applied          1     ← the DROP really ran there
--   delete_policies          0     ← the policy is gone
--   authenticated DELETE     false
--   table comment            170000's
--
-- A fresh replay applied the tombstone instead, so the policy survived from
-- 20260918135500 and the comment was the original. Same security outcome —
-- no DELETE grant on either — but two databases in different states, and
-- coach_notes_privacy.sql now asserts the policy EXISTS. That assertion is
-- green on the PGlite replay it runs against and would have FAILED against
-- the preview. A test that passes only because it never meets the divergent
-- database is the defect class this branch keeps writing guards about; the
-- tombstone hid a difference rather than closing it.
--
-- So 20260919170000 is restored to its byte-identical original, and the
-- reconciliation lives here, where it can run on both.
--
-- ── Why this converges
--
--   fresh replay   135500 creates the policy
--                  170000 drops it, re-derives grants
--                  193112 re-derives again, excluding deny-only policies
--                  THIS   recreates the policy
--   already applied (preview, and any database past 193112)
--                  ...all of the above is skipped...
--                  THIS   recreates the policy
--
--   both end at:   policy present · no DELETE grant · the same comment
--
-- Stamping after 193112 is what makes recreating a deny policy safe. Under
-- #62's rule this file would have handed the DELETE grant straight back;
-- under #68's it cannot, because the derivation now ignores a policy that can
-- never admit a row. The post-condition below asserts both halves rather than
-- trusting that ordering, so a future migration that re-derives grants with
-- the old blunt rule fails here instead of silently restoring the surface.
--
-- No data is modified. Production never applied 20260919170000, so for it
-- this is a no-op against a policy that was never removed — which is exactly
-- what convergence means.
-- ============================================================

-- ── 1. The policy, restored ──────────────────────────────────
-- Identical to the definition in 20260918135500. DROP-then-CREATE rather than
-- a conditional, so this converges from either starting state and can be
-- replayed.
DROP POLICY IF EXISTS "No shared feedback deletion" ON public.coach_shared_feedback;
CREATE POLICY "No shared feedback deletion"
  ON public.coach_shared_feedback FOR DELETE TO authenticated
  USING (false);


-- ── 2. The comment, corrected to the truth it now describes ──
-- 20260919170000 set this to say there is deliberately no DELETE policy. That
-- stopped being true the moment the line above ran, and a comment that
-- contradicts the catalogue is worse than none: it is the thing the next
-- person greps for.
COMMENT ON TABLE public.coach_shared_feedback IS
  'Coach feedback written for a child to read, published explicitly and retractably. '
  'DELETION IS NOT SUPPORTED, and is refused twice over: `authenticated` holds no DELETE '
  'privilege on this table, and the "No shared feedback deletion" policy denies every row '
  'even if one were granted. Both barriers are asserted together in '
  'supabase/tests/coach_notes_privacy.sql. The deny policy is safe to hold under the '
  'grant-derivation model because 20260919193112 excludes policies that can never admit a '
  'row; under the earlier model in 20260919120001 it produced the DELETE grant it forbids, '
  'which is why 20260919170000 removed it and why this file could restore it. '
  'Retraction is setting published_at to NULL, which removes the row from the child and '
  'their parent while keeping the record.';


-- ── 3. Post-conditions: the pair, on whichever history ran ───
DO $migration$
DECLARE
  problems text := '';
BEGIN
  -- Barrier one: the privilege must not exist.
  IF has_table_privilege('authenticated', 'public.coach_shared_feedback', 'DELETE') THEN
    problems := problems ||
      E'\n  authenticated holds DELETE on coach_shared_feedback — restoring the deny policy '
      'has re-derived the grant it forbids, which is the #62 defect returning';
  END IF;

  IF has_table_privilege('anon', 'public.coach_shared_feedback', 'DELETE') THEN
    problems := problems || E'\n  anon holds DELETE on coach_shared_feedback';
  END IF;

  -- Barrier two: the policy must be there. This is the half the tombstone
  -- could not deliver, and the reason this file exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'coach_shared_feedback'
      AND policyname = 'No shared feedback deletion'
      AND cmd = 'DELETE'
      AND coalesce(qual, '') IN ('false', '(false)')
  ) THEN
    problems := problems ||
      E'\n  coach_shared_feedback has no deny-all DELETE policy — the two histories have '
      'not converged';
  END IF;

  -- And the grants the application actually needs must be intact, so a
  -- convergence fix cannot pass by revoking everything.
  IF NOT (has_table_privilege('authenticated', 'public.coach_shared_feedback', 'SELECT')
      AND has_table_privilege('authenticated', 'public.coach_shared_feedback', 'INSERT')
      AND has_table_privilege('authenticated', 'public.coach_shared_feedback', 'UPDATE')) THEN
    problems := problems ||
      E'\n  coach_shared_feedback lost SELECT/INSERT/UPDATE for authenticated; publishing '
      'and retraction both break';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Shared-feedback deletion barriers post-condition failed:%', problems;
  END IF;
END;
$migration$;

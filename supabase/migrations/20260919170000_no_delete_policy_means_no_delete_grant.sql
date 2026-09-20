-- ============================================================
-- A deny policy manufactures the grant it exists to prevent.
--
-- 20260918135500 created coach_shared_feedback with a documentary policy:
--
--   CREATE POLICY "No shared feedback deletion"
--     ON public.coach_shared_feedback FOR DELETE TO authenticated
--     USING (false);
--
-- It granted nothing. It existed to say out loud that published feedback a
-- child has read is not removable, and to make that intent greppable.
--
-- 20260919120001 (#62) then changed how grants are decided: they are DERIVED
-- from pg_policies at apply time rather than taken from a list. That fix is
-- right, it is better than the list, and it closed a real defect. But its
-- input is "does a policy exist for this operation", not "does that policy
-- permit anything" — so a policy whose qualifier is a constant FALSE now
-- produces a GRANT for the operation it forbids.
--
-- Caught on merge, not by reading: replaying this branch on the new main
-- failed coach_notes_privacy.sql with
--
--   K9: authenticated must not hold DELETE on coach_shared_feedback — the
--   no-deletion policy should not be the only thing standing between a child
--   and a removed record
--
-- I predicted this on #62 before it merged and it is the one part of that
-- review not yet acted on. The fix belongs here rather than there: #62's
-- derivation is sound, and the thing that is wrong is a documentary policy of
-- mine that was always redundant.
--
-- ── Why dropping it is strictly safer than keeping it
--
-- RLS denies by default. With no permissive DELETE policy, a DELETE is refused
-- whether or not the grant exists. So:
--
--   before   policy USING(false)  +  DELETE grant (derived from that policy)
--            → one barrier: RLS. The grant is real surface.
--   after    no policy            +  no DELETE grant
--            → two barriers: no privilege at all, and no permissive policy.
--
-- The intent the policy carried moves into a COMMENT, which cannot be mistaken
-- by a grant-derivation pass for a permission that someone wants.
--
-- This does not weaken Tarek's original finding on #44, which was about
-- TRUNCATE — TRUNCATE is not governed by RLS at all, so for it the grant IS
-- the only barrier. That revoke stands and is asserted separately.
-- ============================================================

DROP POLICY IF EXISTS "No shared feedback deletion" ON public.coach_shared_feedback;

-- Re-derive this table's grants now that the deny policy is gone, mirroring
-- what 20260919120001 does for every table. Written explicitly rather than
-- re-running that migration's loop, so this file's effect is readable on its
-- own: exactly what a policy backs, and nothing else.
REVOKE ALL ON TABLE public.coach_shared_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.coach_shared_feedback TO authenticated;

COMMENT ON TABLE public.coach_shared_feedback IS
  'Coach feedback written for a child to read, published explicitly and retractably. '
  'DELETION IS NOT SUPPORTED: there is deliberately no DELETE policy and no DELETE grant, '
  'so RLS refuses it by default and the privilege does not exist either. This was once '
  'expressed as a FOR DELETE ... USING (false) policy; under the derived-grant model in '
  '20260919120001 such a policy produces the very DELETE grant it was written to forbid, '
  'so the intent lives here instead. Retraction is setting published_at to NULL, which '
  'removes the row from the child and their parent while keeping the record.';

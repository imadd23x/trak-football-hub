-- ============================================================
-- WITHDRAWN — intentionally does nothing. Kept because it was applied.
--
-- This version once dropped the "No shared feedback deletion" policy from
-- coach_shared_feedback. The reason was real: #62 derived grants from
-- pg_policies without regard for whether a policy PERMITS anything, so a
-- FOR DELETE ... USING (false) policy manufactured the DELETE grant it exists
-- to forbid.
--
-- @imadd23x then fixed that at the source in #68 (20260919193112): deny-only
-- policies are excluded from derivation, so the policy is harmless and stays.
-- His A1c asserts the pair — "does not grant DELETE behind its no-deletion
-- policy" AND "still carries its no-deletion policy (both barriers, not one)"
-- — on every append-only table. coach_shared_feedback is now asserted the same
-- way in coach_notes_privacy.sql, rather than being the one table that follows
-- a different rule.
--
-- ── Why this file is empty rather than deleted
--
-- I deleted it first, and that was wrong for a reason the team has already
-- written down. #68's own description says it: "Once applied, do not rename
-- migrations or rewrite history; use a reviewed forward correction."
--
-- It had been applied — to this PR's Supabase preview branch, which recorded
-- version 20260919170000 in schema_migrations. Removing the file left the
-- database holding a version the repository no longer contained, and the
-- preview failed exactly as it should:
--
--   Supabase Preview — Remote migration versions not found in local
--   migrations directory.
--
-- Production never applied it, so nothing there was at risk. But the rule is
-- not about where it happened to be applied; it is about histories that stop
-- agreeing. A tombstone keeps every database's history valid — already-applied
-- ones skip it, fresh ones apply nothing — and leaves the reversal legible
-- instead of leaving a hole where a version used to be.
--
-- The alternative was resetting the preview branch, which would have cleared
-- the symptom by discarding the evidence, and taught the next person that
-- deleting an applied migration is survivable.
-- ============================================================

DO $withdrawn$
BEGIN
  RAISE NOTICE 'Migration 20260919170000 was withdrawn; superseded by 20260919193112 (#68). No schema change.';
END;
$withdrawn$;

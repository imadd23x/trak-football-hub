-- ============================================================
-- K9, final piece: a parent reads their child's PUBLISHED coach feedback.
--
-- 20260918135500 deliberately left this out, with a comment saying so:
--
--   "Deliberately absent: a parent policy. Imad's decision says 'shared
--    feedback' without saying shared with whom, and a guardian reading their
--    child's coaching feedback is a consent question rather than a schema one."
--
-- That question is now answered, and by a person rather than by agents. Imad's
-- answer was yes — published feedback only, the same content the child sees,
-- nothing more — and he asked explicitly that it be put to Kostas for a human
-- decision before it landed, "because it defines what a parent can see about
-- their child and shouldn't be decided by two agents agreeing." Kostas decided
-- yes on those terms. Both are in #coding-agent-reviews, 19 September.
--
-- That comment in 20260918135500 is now stale. It is NOT edited: an applied
-- migration is a historical record, and this file is where the decision lives.
--
-- ── What a parent can see, and what they still cannot
--
--   published_at IS NOT NULL   a draft the coach has not published is not
--                              visible to the child, and is not visible to the
--                              parent either. Publishing stays one deliberate
--                              act with one audience.
--   their own child only       via player_parent_links. A coach's other
--                              children are not reachable from a parent's
--                              session.
--   coach_assessment_notes     untouched, and stays coach-private. K9 made it
--                              private and this does not reopen it. The parent
--                              sees what the child sees; the coach's working
--                              notes are neither.
--
-- Retraction keeps working for parents for free: clearing published_at removes
-- the row from this policy's result exactly as it does for the player.
--
-- ⚠️ The join condition below is defence in depth, not the thing doing the
-- work, and that is worth knowing before someone "simplifies" it.
--
-- Mutation testing found it: replacing the join with ON true — so that any
-- parent link belonging to the caller satisfies the EXISTS — does NOT expose
-- another child's feedback, and the whole suite still passes. RLS applies to
-- coach_assessments inside this policy's subquery, and 20260612000001 already
-- scopes a parent's view of that table to their own linked children, so the
-- subquery cannot reach another family's row however this join is written.
--
-- Two consequences, both deliberate:
--   * the explicit condition stays, because a guarantee that rests on one
--     policy is weaker than one that rests on two;
--   * if a future migration widens a parent's read of coach_assessments, THIS
--     policy widens with it, silently. coach_notes_privacy.sql now asserts that
--     upstream scoping directly, so that change fails there and names this
--     policy rather than surfacing as a parent reading another family's
--     feedback.
-- ============================================================

DROP POLICY IF EXISTS "Parents read published feedback for their children" ON public.coach_shared_feedback;
CREATE POLICY "Parents read published feedback for their children"
  ON public.coach_shared_feedback FOR SELECT TO authenticated
  USING (
    published_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.coach_assessments ca
      JOIN public.squad_players sp ON sp.id = ca.squad_player_id
      JOIN public.player_parent_links l ON l.player_user_id = sp.linked_player_id
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND l.parent_user_id = auth.uid()
    )
  );

-- ── Re-grant, and why this is here rather than in #62
--
-- #62 (20260919120001) revokes on EVERY table in public and re-grants from a
-- list that is a snapshot of main at the time it was written.
-- coach_shared_feedback is created at 20260918135500 — EARLIER — so on a fresh
-- replay it exists when that revoke runs and is not in the re-grant list. Its
-- own post-condition then aborts naming this table and four operations, which
-- is the guard working exactly as designed.
--
-- The agreed merge order (#62 → #44) fixes the DEPLOY, because only pending
-- migrations are applied: at #62's deploy this table does not exist yet.
--
-- ⚠️ It does NOT fix a fresh REPLAY, and the re-grant below does not rescue it
-- either. I first claimed it would; replaying this branch together with #62's
-- three migrations disproves that:
--
--   Migration 20260919120001_revoke_app_role_table_privileges.sql:
--     Privilege post-condition failed:
--       policy exists for SELECT on coach_shared_feedback but authenticated has no grant
--       ... INSERT ... UPDATE ... DELETE
--
-- The post-condition aborts INSIDE 20260919120001, so nothing stamped later
-- ever runs. A fix on this side is impossible by construction; it belongs in
-- #62 and is reported there. The grant below is kept because it makes this
-- table's privileges explicit after any blanket revoke that does survive — it
-- is insurance, not the remedy, and is documented as such rather than left to
-- look like one.
--
-- Two things that replay also showed, both for #62 rather than here:
--   * a table created by an EARLIER migration than #62's is unreachable by its
--     snapshot grant list, so the list cannot be the mechanism;
--   * the DELETE line is a false positive. "No shared feedback deletion" is a
--     deny policy — USING (false) — deliberately paired with NO grant. A
--     policy existing without a grant is correct there, not a mismatch.
--
-- This mirrors 20260918135500's grant exactly. It does not widen it: no DELETE
-- (deletion is refused by policy), and no TRUNCATE — which is not governed by
-- RLS at all, and whose presence here was the bug Tarek demonstrated on #44 by
-- emptying the table as a player.
GRANT SELECT, INSERT, UPDATE ON TABLE public.coach_shared_feedback TO authenticated;
REVOKE ALL ON TABLE public.coach_shared_feedback FROM PUBLIC, anon;

COMMENT ON POLICY "Parents read published feedback for their children" ON public.coach_shared_feedback IS
  'A linked parent reads the PUBLISHED feedback for their own child only — the same content the child sees. Never a draft, never another child, never coach_assessment_notes. Decided by Imad and confirmed by Kostas, 19 September 2026.';

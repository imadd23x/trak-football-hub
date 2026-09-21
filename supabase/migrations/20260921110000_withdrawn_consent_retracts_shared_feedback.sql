-- ============================================================
-- Withdrawing consent must retract what was already published
--
-- @imadd23x raised this approving #44, as a question rather than a defect:
-- coach_shared_feedback's reads do not re-check squad_player_consent_required
-- the way #40's player_feedback does, so a withdrawn consent leaves
-- already-published shared notes readable — "decide whether that's intended".
--
-- It is not intended. It is an inconsistency, and the argument against it is
-- already written down and already merged, in 20260920140000 by @t-bones29:
--
--   [F-3] Consent is checked on read, not only at publication. A sole guardian
--   who withdraws must stop the child receiving what was published while
--   consent held — otherwise withdrawal only blocks future feedback, which is
--   not what withdrawing consent means.
--
-- That reasoning is correct and it does not stop at his table. The two tables
-- hold the same kind of thing — a coach's words about a child, released to
-- that child — so a guardian who withdraws should not have to know which
-- feature wrote the sentence in order to withdraw it.
--
-- Both reads are fixed here, the player's (from 20260918135500) and the
-- parent's (from 20260919150000). The parent's matters at least as much: a
-- guardian withdrawing consent on behalf of their child should not continue
-- receiving the child's coaching feedback themselves.
--
-- ── What this deliberately does NOT do
--
-- Nothing is deleted and nothing is unpublished. published_at stays as it was,
-- so consent granted again restores exactly what was visible before, with no
-- coach action and no lost record. Withdrawal suspends access; it does not
-- rewrite history. That matters for the coach's own read, which is untouched:
-- the coach wrote it and must keep seeing their own work, including for the
-- retraction path (published_at -> NULL) that existed before this.
--
-- squad_player_consent_required() returns false for an unlinked roster row
-- (20260912000001), so this cannot lock a coach out of a row that has no
-- account behind it. It is also SECURITY DEFINER and already EXECUTE-granted
-- to authenticated, so a policy may call it.
--
-- Rollback: restore the two policies from 20260918135500 and 20260919150000
-- without the NOT squad_player_consent_required(...) clause.
-- ============================================================

-- ── The player's own read ────────────────────────────────────
DROP POLICY IF EXISTS "Players read published feedback for their assessments"
  ON public.coach_shared_feedback;
CREATE POLICY "Players read published feedback for their assessments"
  ON public.coach_shared_feedback FOR SELECT TO authenticated
  USING (
    published_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.coach_assessments ca
      JOIN public.squad_players sp ON sp.id = ca.squad_player_id
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND sp.linked_player_id = auth.uid()
        AND NOT public.squad_player_consent_required(sp.id)
    )
  );

-- ── The linked parent's read ─────────────────────────────────
DROP POLICY IF EXISTS "Parents read published feedback for their children"
  ON public.coach_shared_feedback;
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
        AND NOT public.squad_player_consent_required(sp.id)
    )
  );


-- ── Post-conditions ──────────────────────────────────────────
-- Both policies must exist AND both must carry the consent clause. Asserting
-- only that they exist would pass for the versions this migration replaces,
-- which is the whole defect.
DO $migration$
DECLARE
  problems text := '';
  r        record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'Players read published feedback for their assessments',
      'Parents read published feedback for their children'
    ]) AS policyname
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'coach_shared_feedback'
        AND policyname = r.policyname AND cmd = 'SELECT'
    ) THEN
      problems := problems || format(E'\n  %s is absent', r.policyname);
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'coach_shared_feedback'
        AND policyname = r.policyname
        AND qual LIKE '%squad_player_consent_required%'
    ) THEN
      problems := problems || format(
        E'\n  %s does not re-check consent on read', r.policyname);
    END IF;
  END LOOP;

  -- The coach's own read must NOT have acquired the clause. A coach locked out
  -- of their own words by a guardian's withdrawal could not retract them.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'coach_shared_feedback'
      AND policyname = 'Coaches read own shared feedback'
      AND qual LIKE '%squad_player_consent_required%'
  ) THEN
    problems := problems ||
      E'\n  the coach''s own read now depends on consent; they could not retract';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Consent-on-read post-condition failed:%', problems;
  END IF;
END;
$migration$;

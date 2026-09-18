-- ============================================================
-- K9 / X9: coach notes become genuinely private, and shared feedback
-- becomes a separate thing a coach writes on purpose.
--
-- Imad's decision: restore privacy for all existing coach notes, explicit
-- publication for future shared feedback, no auto-copy.
--
-- ── What was actually wrong
--
-- April made coach_assessment_notes coach-only. May added
--   "Players can read notes for their own assessments"
-- with no condition at all: a linked player reads EVERY note on their own
-- assessments. The table has no publication concept — its columns are
-- id, assessment_id, coach_user_id, note, created_at — so there is nothing
-- in it that could express "this one is shared". That is why X9 is a policy
-- hole rather than a bug: the schema cannot represent the intended state.
--
-- Live at time of writing: 8 notes, 4 of them readable by a linked player.
--
-- ── Why a separate table rather than a published_at flag
--
-- A flag on the same row would mean publishing a note exposes the note's own
-- text — the words the coach wrote as a private assessment aid. That makes
-- "no auto-copy" meaningless, because there would be nothing to copy: the
-- private text IS the shared text.
--
-- RLS cannot help here. It is row-level: a SELECT policy that lets a player
-- see the row lets them see every column of it, `note` included. Column-level
-- GRANTs apply to the role rather than the policy, and coaches are
-- `authenticated` too, so revoking the column from players revokes it from
-- coaches. A definer view could project a subset, but #35 has just finished
-- making every view security_invoker = true and reintroducing a definer view
-- would cut against that.
--
-- So the private note and the shared feedback live in different tables. The
-- separation is structural: there is no path by which `note` reaches a player,
-- and no code can accidentally copy it, because copying would mean writing to
-- a different table on purpose.
--
-- ── What a player can now see
--
-- Nothing, until a coach writes shared feedback and publishes it. Every
-- existing note becomes private immediately, with no backfill — there is no
-- data migration to get wrong, because the player's read path is simply gone.
-- ============================================================

-- ── 1. coach_assessment_notes becomes coach-only again
--
-- Dropped rather than narrowed. A narrowed version of this policy would still
-- be a player-facing read path on a table whose whole content is private, and
-- the next person to widen it would be widening something that already looked
-- legitimate.
DROP POLICY IF EXISTS "Players can read notes for their own assessments" ON public.coach_assessment_notes;

COMMENT ON TABLE public.coach_assessment_notes IS
  'Private coach working notes. Never readable by players or parents — see 20260918135500. Feedback intended for a child goes in coach_shared_feedback, written separately and published explicitly.';


-- ── 2. Shared feedback: written on purpose, published on purpose

CREATE TABLE IF NOT EXISTS public.coach_shared_feedback (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid        NOT NULL UNIQUE REFERENCES public.coach_assessments(id) ON DELETE CASCADE,
  coach_user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body           text        NOT NULL,
  -- NULL means drafted but not published. A coach can write shared feedback
  -- and publish it later, and can retract by setting this back to NULL.
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_shared_feedback ENABLE ROW LEVEL SECURITY;

-- Coaches: the same ownership shape as the notes table, so departure and
-- transfer behave identically. squad_player_is_mine() already excludes a
-- departed coach (20260917000002) and an out-of-org roster row
-- (20260917000004), so this inherits both without restating them.
DROP POLICY IF EXISTS "Coaches insert own shared feedback" ON public.coach_shared_feedback;
CREATE POLICY "Coaches insert own shared feedback"
  ON public.coach_shared_feedback FOR INSERT TO authenticated
  WITH CHECK (
    public.is_coach()
    AND coach_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
    )
  );

DROP POLICY IF EXISTS "Coaches read own shared feedback" ON public.coach_shared_feedback;
CREATE POLICY "Coaches read own shared feedback"
  ON public.coach_shared_feedback FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND ca.coach_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Coaches update own shared feedback" ON public.coach_shared_feedback;
CREATE POLICY "Coaches update own shared feedback"
  ON public.coach_shared_feedback FOR UPDATE TO authenticated
  USING (
    public.is_coach()
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND ca.coach_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_coach()
    AND coach_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.coach_assessments ca
      WHERE ca.id = coach_shared_feedback.assessment_id
        AND ca.coach_user_id = auth.uid()
        AND public.squad_player_is_mine(ca.squad_player_id)
    )
  );

-- Matches the notes table: feedback a child has read is not quietly removable.
DROP POLICY IF EXISTS "No shared feedback deletion" ON public.coach_shared_feedback;
CREATE POLICY "No shared feedback deletion"
  ON public.coach_shared_feedback FOR DELETE TO authenticated
  USING (false);

-- The player: only published rows, only their own.
DROP POLICY IF EXISTS "Players read published feedback for their assessments" ON public.coach_shared_feedback;
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
    )
  );

-- Deliberately absent: a parent policy. Imad's decision says "shared
-- feedback" without saying shared with whom, and a guardian reading their
-- child's coaching feedback is a consent question rather than a schema one.
-- Parents have no access to this table until that is decided, which is the
-- safe direction to be wrong in.

DROP TRIGGER IF EXISTS coach_shared_feedback_touch ON public.coach_shared_feedback;
CREATE TRIGGER coach_shared_feedback_touch
  BEFORE UPDATE ON public.coach_shared_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Published rows are what the player path reads; the coach path goes by
-- assessment_id, which the UNIQUE constraint already indexes.
CREATE INDEX IF NOT EXISTS coach_shared_feedback_published_idx
  ON public.coach_shared_feedback (assessment_id) WHERE published_at IS NOT NULL;

-- `authenticated` must be in the REVOKE, not only PUBLIC and anon. This schema
-- grants broadly by default, so a new table inherits privileges the migration
-- never asked for — including TRUNCATE, which is NOT subject to RLS. Without
-- this, any signed-in account (every coach, player and parent in the pilot)
-- could empty every child's published feedback, and no policy could stop it:
-- "No shared feedback deletion" governs DELETE and TRUNCATE is not DELETE.
--
-- Tarek demonstrated it on #44 by running TRUNCATE as a player against the real
-- policies: 1 row before, 0 after, no error. The GRANT below then restores
-- exactly what the application needs and nothing else.
REVOKE ALL ON TABLE public.coach_shared_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.coach_shared_feedback TO authenticated;

COMMENT ON COLUMN public.coach_shared_feedback.body IS
  'Written by the coach for the child to read. Never populated from coach_assessment_notes.note — the separation is the point.';

-- T2 — nothing an AI writes reaches a child until a coach has approved it.
--
-- Today `player-feedback` persists nothing at all: it reads the coach's
-- private note, generates text, and returns it straight to the caller. There
-- is no draft, no approval, and no record of what a child was told. Slide 3 of
-- the deck says "the coach reviews every word"; that sentence is currently
-- false.
--
-- Two tables rather than one with a status column. A child must not be able to
-- read unapproved text, and that must not depend on a policy being written
-- correctly and staying written. With two tables the child has no grant on the
-- draft table at all, so a draft is unreachable structurally rather than
-- conditionally.
--
-- That is the direct lesson from coach_assessment_notes: created coach-only in
-- April with a migration comment stating "Players & parents have NO access",
-- then opened in May by 20260524000001_player_feedback_rls.sql adding a player
-- SELECT policy for the feedback feature — retroactively exposing every note
-- written under that promise. A status column on one table is one policy edit
-- away from the same outcome. A missing grant is much harder to undo by
-- accident.

-- ── 1. Drafts — coach-only, never reachable by a child ──────────────────────

CREATE TABLE IF NOT EXISTS public.ai_feedback_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_player_id  uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  assessment_id    uuid REFERENCES public.coach_assessments(id) ON DELETE SET NULL,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  generated_text   text NOT NULL,
  model            text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_drafts_squad_player
  ON public.ai_feedback_drafts (squad_player_id, created_at DESC);

ALTER TABLE public.ai_feedback_drafts ENABLE ROW LEVEL SECURITY;

-- Coaches only, and only for a roster row that is theirs in their academy.
-- squad_player_is_mine() already excludes departed coaches and enforces the
-- academy, so this inherits future tightening rather than restating the rule.
DROP POLICY IF EXISTS "Coaches manage drafts for their own roster" ON public.ai_feedback_drafts;
CREATE POLICY "Coaches manage drafts for their own roster"
  ON public.ai_feedback_drafts
  FOR ALL TO authenticated
  USING (public.squad_player_is_mine(squad_player_id))
  WITH CHECK (public.squad_player_is_mine(squad_player_id));

-- There is deliberately NO player or parent policy on this table, and none
-- should be added. If a child needs to see something, it is published.


-- ── 2. Publications — what a child may actually read ────────────────────────

CREATE TABLE IF NOT EXISTS public.player_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_player_id  uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  assessment_id    uuid REFERENCES public.coach_assessments(id) ON DELETE SET NULL,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  draft_id         uuid REFERENCES public.ai_feedback_drafts(id) ON DELETE SET NULL,
  published_text   text NOT NULL,
  -- The coach. The AI is never an author: it produces a draft, a person
  -- publishes. draft_id records provenance and is null for coach-written text.
  author_user_id   uuid NOT NULL,
  revision         integer NOT NULL DEFAULT 1,
  published_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_player_feedback_current
  ON public.player_feedback (squad_player_id, published_at DESC)
  WHERE superseded_at IS NULL;

ALTER TABLE public.player_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coaches manage feedback for their own roster" ON public.player_feedback;
CREATE POLICY "Coaches manage feedback for their own roster"
  ON public.player_feedback
  FOR ALL TO authenticated
  USING (public.squad_player_is_mine(squad_player_id))
  WITH CHECK (public.squad_player_is_mine(squad_player_id));

-- The child reads only the current revision of their own feedback.
-- An edit supersedes rather than overwrites, so the academy keeps the audit
-- trail, but the child is shown one current version rather than a history of
-- what their coach changed their mind about.
DROP POLICY IF EXISTS "Players read their own current feedback" ON public.player_feedback;
CREATE POLICY "Players read their own current feedback"
  ON public.player_feedback
  FOR SELECT TO authenticated
  USING (
    superseded_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.squad_players sp
      WHERE sp.id = player_feedback.squad_player_id
        AND sp.linked_player_id = auth.uid()
    )
  );

-- No parent policy here on purpose. P4 owns what a parent sees and is building
-- a parent projection; adding a policy to this table on his behalf would be
-- the coach_assessment_notes mistake again, from the other direction. The
-- extension point is this table, reading superseded_at IS NULL.


-- ── 3. Publishing is an act of authorship, not a visibility toggle ──────────

CREATE OR REPLACE FUNCTION public.publish_player_feedback(
  p_squad_player_id uuid,
  p_text            text,
  p_draft_id        uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_org        uuid;
  v_assessment uuid;
  v_revision   integer;
  v_id         uuid;
  v_text       text := btrim(coalesce(p_text, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- SECURITY DEFINER bypasses RLS, so the ownership rule is restated here on
  -- purpose. This is the class of hole F5 turned out to be: a definer function
  -- that authorised on ownership alone and went around every policy.
  IF NOT public.squad_player_is_mine(p_squad_player_id) THEN
    RAISE EXCEPTION 'Not your player';
  END IF;

  IF NOT public.is_coach() THEN
    RAISE EXCEPTION 'Only a coach can publish feedback';
  END IF;

  IF v_text = '' THEN
    RAISE EXCEPTION 'Feedback cannot be empty';
  END IF;

  -- A child below the consent threshold with no guardian authorisation must
  -- not receive anything, approved or not. This is the same gate the
  -- assessment and award paths use.
  IF public.squad_player_consent_required(p_squad_player_id) THEN
    RAISE EXCEPTION 'Parental consent has not been given for this player';
  END IF;

  SELECT organization_id INTO v_org
  FROM public.squad_players WHERE id = p_squad_player_id;

  -- Provenance: a draft carries the assessment it was generated from. A
  -- coach-written publication has no draft and no assessment.
  IF p_draft_id IS NOT NULL THEN
    SELECT assessment_id INTO v_assessment
    FROM public.ai_feedback_drafts
    WHERE id = p_draft_id AND squad_player_id = p_squad_player_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That draft does not belong to this player';
    END IF;
  END IF;

  -- Supersede rather than overwrite: the child sees one current version, the
  -- academy keeps the history of what was said and when.
  UPDATE public.player_feedback
  SET superseded_at = now()
  WHERE squad_player_id = p_squad_player_id
    AND superseded_at IS NULL;

  SELECT COALESCE(MAX(revision), 0) + 1 INTO v_revision
  FROM public.player_feedback
  WHERE squad_player_id = p_squad_player_id;

  INSERT INTO public.player_feedback (
    squad_player_id, assessment_id, organization_id, draft_id,
    published_text, author_user_id, revision
  )
  VALUES (
    p_squad_player_id, v_assessment, v_org, p_draft_id,
    v_text, v_uid, v_revision
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.publish_player_feedback(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.publish_player_feedback(uuid, text, uuid) TO authenticated;

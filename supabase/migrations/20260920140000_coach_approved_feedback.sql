-- T2 — nothing an AI writes reaches a child until a coach has approved it.
--
-- VERSION NOTE, corrected. An earlier version of this comment said the
-- renumber explained why this branch's Supabase preview was failing. That was
-- wrong and is retracted; the truth is the other way round.
--
-- This file has been renumbered TWICE, both times by me:
--   20260918120000  ->  20260919130000  ->  20260920140000
-- The preview applied 20260918120000 and recorded it. Renaming the file left
-- that database holding a version the repository does not contain, which is
-- exactly the state that produces "Remote migration versions not found in
-- local migrations directory". Kostas read the console and measured it.
--
-- The content also changed after that apply — revision 2 below closes five
-- holes Imad found on native PostgreSQL. So the preview holds revision 1 of a
-- migration the repository now carries as revision 2 under a third name.
--
-- Renaming an applied migration is what CLAUDE.md forbids and what #44 was
-- corrected for twice. Nothing deployed has ever carried this migration —
-- main does not contain it — so the only database affected is a disposable
-- preview, which is a materially smaller blast radius than #44's, but the
-- mistake is the same one.
--
-- NOT renamed a third time. The number is now stable and sorts after
-- everything on main and after #70, #72 and #74. Do not renumber it again in
-- either direction; if this ever needs changing, add a forward migration.
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
--
-- Revision 2 of this migration closes five holes Imad found by replaying it on
-- native PostgreSQL 17, which I could not do (no local Postgres). Each is
-- marked [F-n] below. The two-table shape survived his review — child draft
-- isolation, foreign-academy reads, guarded RPC denials and sequential
-- supersession all passed. What failed was enforcement around it.

-- ── 1. Drafts — coach-only, never reachable by a child ──────────────────────

CREATE TABLE IF NOT EXISTS public.ai_feedback_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_player_id  uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  assessment_id    uuid REFERENCES public.coach_assessments(id) ON DELETE SET NULL,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  generated_text   text NOT NULL,
  model            text,
  -- [F-2] Provenance cannot be asserted by the client. Defaulted here and
  -- pinned by the policy's WITH CHECK below.
  created_by       uuid NOT NULL DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_drafts_squad_player
  ON public.ai_feedback_drafts (squad_player_id, created_at DESC);

ALTER TABLE public.ai_feedback_drafts ENABLE ROW LEVEL SECURITY;

-- [F-4] This database grants broadly by default, so a new table inherits
-- privileges nobody asked for — including TRUNCATE for anon. Revoking the
-- default is not enough on its own; the grants a role should have are stated
-- explicitly. Same lesson as the operational views in #35.
REVOKE ALL ON TABLE public.ai_feedback_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.ai_feedback_drafts TO authenticated;

-- Coaches only, and only for a roster row that is theirs in their academy.
-- squad_player_is_mine() already excludes departed coaches and enforces the
-- academy, so this inherits future tightening rather than restating the rule.
-- One policy per operation, matching the grant above exactly. This was FOR ALL,
-- which claimed UPDATE while the grant deliberately withholds it — nothing
-- updates a draft, because the coach's edited text travels to
-- publish_player_feedback() as an argument rather than being written back.
--
-- #62's privilege post-condition treats "a policy governs an operation the
-- grant does not allow" as a fault, and it is right to. The two should say the
-- same thing; a policy for an operation nothing can perform is a claim about
-- access that nothing honours.
DROP POLICY IF EXISTS "Coaches manage drafts for their own roster" ON public.ai_feedback_drafts;
DROP POLICY IF EXISTS "Coaches read drafts for their own roster" ON public.ai_feedback_drafts;
CREATE POLICY "Coaches read drafts for their own roster"
  ON public.ai_feedback_drafts
  FOR SELECT TO authenticated
  USING (public.squad_player_is_mine(squad_player_id));

DROP POLICY IF EXISTS "Coaches insert drafts for their own roster" ON public.ai_feedback_drafts;
CREATE POLICY "Coaches insert drafts for their own roster"
  ON public.ai_feedback_drafts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.squad_player_is_mine(squad_player_id)
    -- [F-2] A draft cannot be attributed to another coach.
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Coaches delete drafts for their own roster" ON public.ai_feedback_drafts;
CREATE POLICY "Coaches delete drafts for their own roster"
  ON public.ai_feedback_drafts
  FOR DELETE TO authenticated
  USING (public.squad_player_is_mine(squad_player_id));

-- There is deliberately NO player or parent policy on this table, and none
-- should be added. If a child needs to see something, it is published.


-- [F-2] Academy and assessment provenance are stamped from the roster row,
-- never taken from the client, and an assessment must belong to the same
-- player it is being attached to.
CREATE OR REPLACE FUNCTION public.stamp_feedback_draft_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  SELECT sp.organization_id INTO NEW.organization_id
  FROM public.squad_players sp WHERE sp.id = NEW.squad_player_id;

  IF NEW.assessment_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.coach_assessments ca
       WHERE ca.id = NEW.assessment_id
         AND ca.squad_player_id = NEW.squad_player_id
     ) THEN
    RAISE EXCEPTION 'That assessment does not belong to this player';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stamp_feedback_draft_provenance ON public.ai_feedback_drafts;
CREATE TRIGGER trg_stamp_feedback_draft_provenance
  BEFORE INSERT OR UPDATE ON public.ai_feedback_drafts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_feedback_draft_provenance();


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

-- [F-5] Two coaches publishing at the same moment both computed revision 1 and
-- left two current rows. A read-then-write cannot be made safe by trying
-- harder; the database enforces it instead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_player_feedback_one_current
  ON public.player_feedback (squad_player_id)
  WHERE superseded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_player_feedback_revision
  ON public.player_feedback (squad_player_id, revision);

ALTER TABLE public.player_feedback ENABLE ROW LEVEL SECURITY;

-- [F-1] and [F-4] Publication DML goes through publish_player_feedback() and
-- nowhere else. Previously the coach policy was FOR ALL, so an owning coach
-- could INSERT straight past the consent and authorship checks, and could
-- UPDATE or DELETE superseded rows — destroying the audit trail the academy is
-- told it has. Coaches read; the guarded RPC writes.
REVOKE ALL ON TABLE public.player_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.player_feedback TO authenticated;

DROP POLICY IF EXISTS "Coaches manage feedback for their own roster" ON public.player_feedback;
DROP POLICY IF EXISTS "Coaches read feedback for their own roster" ON public.player_feedback;
CREATE POLICY "Coaches read feedback for their own roster"
  ON public.player_feedback
  FOR SELECT TO authenticated
  USING (public.squad_player_is_mine(squad_player_id));

-- The child reads only the current revision of their own feedback.
-- An edit supersedes rather than overwrites, so the academy keeps the audit
-- trail, but the child is shown one current version rather than a history of
-- what their coach changed their mind about.
--
-- [F-3] Consent is checked on read, not only at publication. A sole guardian
-- who withdraws must stop the child receiving what was published while consent
-- held — otherwise withdrawal only blocks future feedback, which is not what
-- withdrawing consent means.
DROP POLICY IF EXISTS "Players read their own current feedback" ON public.player_feedback;
CREATE POLICY "Players read their own current feedback"
  ON public.player_feedback
  FOR SELECT TO authenticated
  USING (
    superseded_at IS NULL
    AND NOT public.squad_player_consent_required(squad_player_id)
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

  -- Lock the roster row BEFORE authorising, not after.
  --
  -- Authorising first left a window: a coach removal committing between the
  -- ownership check and the write still allowed one publication through.
  -- Taking the lock first means a removal already committed is visible to the
  -- check below, and a removal still in flight waits behind us — in which case
  -- the publication genuinely happened before the removal, which is correct.
  PERFORM 1 FROM public.squad_players WHERE id = p_squad_player_id FOR UPDATE;

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

  -- [F-5] The row is already locked above, which also serialises concurrent
  -- publications: the unique indexes make a lost race an error rather than a
  -- second current revision, and the lock makes the ordinary case wait.

  SELECT organization_id INTO v_org
  FROM public.squad_players WHERE id = p_squad_player_id;

  -- [F-2] Provenance: a draft carries the assessment it was generated from,
  -- and the draft must belong to this player. A coach-written publication has
  -- no draft and no assessment.
  IF p_draft_id IS NOT NULL THEN
    SELECT assessment_id INTO v_assessment
    FROM public.ai_feedback_drafts
    WHERE id = p_draft_id AND squad_player_id = p_squad_player_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That draft does not belong to this player';
    END IF;
  END IF;

  -- [F-2] Even by way of a draft, an assessment from another player cannot be
  -- attached. The draft trigger enforces this on write; re-checked here so a
  -- pre-existing row cannot carry a forged reference through publication.
  IF v_assessment IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.coach_assessments ca
       WHERE ca.id = v_assessment AND ca.squad_player_id = p_squad_player_id
     ) THEN
    RAISE EXCEPTION 'That assessment does not belong to this player';
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

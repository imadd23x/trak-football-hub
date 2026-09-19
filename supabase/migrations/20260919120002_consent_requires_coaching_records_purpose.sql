-- ============================================================
-- A recorded consent must actually grant the purpose it gates
--
-- 20260912000001 stores per-purpose choices in `parental_consents.purposes`
-- and gates coach writes on player_has_parental_consent(). That predicate is
-- a bare row-existence check: it never reads `purposes`. A consent recorded
-- with every purpose false — or an empty object — satisfies the
-- coach-assessment gate identically to a full grant. Verified against the
-- live schema on 2026-09-19. The only thing preventing it in the product is
-- one line in ParentConsent.tsx that forces coaching_records to true; any
-- other caller of record_parental_consent() with a normal parent session
-- bypasses it. The invariant "a recorded consent means the coach may assess"
-- was held by TypeScript, not by the data.
--
-- What this does, at three layers so no single one carries the rule:
--   1. player_has_parental_consent() requires purposes.coaching_records to be
--      JSON true. This is the predicate every gate reads, so it closes the
--      hole for every current and future caller.
--   2. record_parental_consent() rejects a grant without it, with a message.
--      A parent who declines coaching records is recorded as *not* consenting
--      — which is what withdraw_parental_consent() already expresses — rather
--      than as a consent row that means nothing.
--   3. A CHECK on the table mirrors the rule in the data itself, so a row
--      that cannot satisfy the gate cannot exist.
--
-- Scope: coaching_records is the purpose the existing gate protects
-- (assessments and awards). recognition and parent_visibility are not gated
-- anywhere today; gating them per purpose is a separate, larger change and
-- is deliberately not started here.
--
-- Existing data: one consent row in production, all purposes true. The CHECK
-- validates it on apply. No rows are modified.
-- Rollback: DROP CONSTRAINT parental_consents_coaching_records_granted and
-- restore the 20260912000001 function bodies.
-- ============================================================

-- ── 1. The predicate every gate reads ────────────────────────
CREATE OR REPLACE FUNCTION public.player_has_parental_consent(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.parental_consents
    WHERE player_user_id = p_user_id
      AND withdrawn_at IS NULL
      AND superseded_by IS NULL
      AND purposes->'coaching_records' = 'true'::jsonb
  );
$fn$;


-- ── 2. Refuse to record a consent that grants nothing ────────
-- Body is 20260912000001's, unchanged except for the added purpose check.
CREATE OR REPLACE FUNCTION public.record_parental_consent(
  p_player_user_id        uuid,
  p_relationship          text,
  p_purposes              jsonb,
  p_notice_version        text,
  p_consent_text          text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_parent uuid := auth.uid();
  v_age    int;
  v_new    uuid;
BEGIN
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- The parent must already be linked to this child. The link is established
  -- by redeeming the invite, which proves control of the invited address.
  IF NOT EXISTS (
    SELECT 1 FROM public.player_parent_links
    WHERE parent_user_id = v_parent AND player_user_id = p_player_user_id
  ) THEN
    RAISE EXCEPTION 'You are not linked to this player';
  END IF;

  IF p_relationship NOT IN ('parent', 'legal_guardian') THEN
    RAISE EXCEPTION 'Relationship must be parent or legal_guardian';
  END IF;

  IF p_purposes IS NULL OR jsonb_typeof(p_purposes) <> 'object' THEN
    RAISE EXCEPTION 'Purposes must be an object of individual choices';
  END IF;

  -- The purpose the gate protects must be granted, or this is a refusal.
  IF p_purposes->'coaching_records' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Consent must grant coaching_records; to decline, do not record a consent';
  END IF;

  IF COALESCE(trim(p_notice_version), '') = ''
     OR COALESCE(trim(p_consent_text), '') = '' THEN
    RAISE EXCEPTION 'Notice version and consent wording must both be recorded';
  END IF;

  v_age := public.player_age_years(p_player_user_id);
  IF v_age IS NULL THEN
    RAISE EXCEPTION 'Player has no date of birth on record';
  END IF;

  -- Close any standing consent rather than editing it.
  UPDATE public.parental_consents
     SET withdrawn_at = now()
   WHERE player_user_id = p_player_user_id
     AND withdrawn_at IS NULL
     AND superseded_by IS NULL;

  INSERT INTO public.parental_consents (
    player_user_id, parent_user_id, relationship_declared, verification_method,
    purposes, notice_version, consent_text, threshold_age, player_age_at_consent
  ) VALUES (
    p_player_user_id, v_parent, p_relationship, 'email_confirmed',
    p_purposes, trim(p_notice_version), trim(p_consent_text),
    public.consent_threshold_age(), v_age
  )
  RETURNING id INTO v_new;

  UPDATE public.parental_consents
     SET superseded_by = v_new
   WHERE player_user_id = p_player_user_id
     AND id <> v_new
     AND superseded_by IS NULL
     AND withdrawn_at IS NOT NULL;

  RETURN v_new;
END;
$fn$;


-- ── 3. The rule lives in the data too ────────────────────────
ALTER TABLE public.parental_consents
  DROP CONSTRAINT IF EXISTS parental_consents_coaching_records_granted;
ALTER TABLE public.parental_consents
  ADD CONSTRAINT parental_consents_coaching_records_granted
  CHECK (purposes->'coaching_records' = 'true'::jsonb);

COMMENT ON CONSTRAINT parental_consents_coaching_records_granted ON public.parental_consents IS
  'A consent row is evidence that coaching records were authorised. A refusal is the absence of a row, or a withdrawal — never a row that grants nothing.';


-- ── 4. Post-conditions ───────────────────────────────────────
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parental_consents_coaching_records_granted'
      AND conrelid = 'public.parental_consents'::regclass
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'parental_consents_coaching_records_granted is missing or not validated';
  END IF;
  IF pg_get_functiondef('public.player_has_parental_consent(uuid)'::regprocedure) NOT LIKE '%coaching_records%' THEN
    RAISE EXCEPTION 'player_has_parental_consent() does not read purposes';
  END IF;
END;
$migration$;

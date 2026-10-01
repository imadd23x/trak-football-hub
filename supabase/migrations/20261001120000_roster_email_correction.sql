-- TRAK-16 (G5) / TRAK-11 (J3), docs/superpowers/specs/2026-10-01-roster-email-correction-design.md:
-- "If an address is wrong, Trak corrects it by hand and records who changed it
-- and when." Only the operator (service role) can do it.
--
-- A guardian is linked to a child by their confirmed email matching the roster
-- email (claim_my_roster_guardian_rows, provision_my_profile), so the roster
-- email is the key to the child. Once an address has been claimed it is never
-- moved: that is an incident for the founders, not a correction. Before then,
-- correcting it means the old address can no longer claim the child.
--
-- The audit keeps hashes of the old and new address, not the addresses: the
-- row itself holds the new one, and the hash proves which value was replaced
-- without keeping a wrong person's address.

CREATE TABLE public.roster_email_corrections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cascades like every roster reference, so erasing a child erases this too.
  roster_child_id    uuid NOT NULL REFERENCES public.roster_children(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('guardian', 'child')),
  roster_guardian_id uuid REFERENCES public.roster_guardians(id) ON DELETE CASCADE,
  corrected_by       text NOT NULL CHECK (btrim(corrected_by) <> ''),
  corrected_at       timestamptz NOT NULL DEFAULT now(),
  reason             text NOT NULL CHECK (btrim(reason) <> ''),
  old_email_sha256   text NOT NULL,
  new_email_sha256   text NOT NULL,
  -- An invitation had already gone to the old address: a G5 near-miss to log.
  was_invited        boolean NOT NULL,
  CONSTRAINT roster_email_corrections_guardian_row
    CHECK ((kind = 'guardian') = (roster_guardian_id IS NOT NULL))
);

ALTER TABLE public.roster_email_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roster_email_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.roster_email_corrections TO service_role;

CREATE FUNCTION public.correct_roster_email(
  p_roster_child_id uuid,
  p_kind            text,
  p_old_email       text,
  p_new_email       text,
  p_corrected_by    text,
  p_reason          text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_old         text := lower(btrim(coalesce(p_old_email, '')));
  v_new         text := lower(btrim(coalesce(p_new_email, '')));
  v_child       public.roster_children%ROWTYPE;
  v_guardian    public.roster_guardians%ROWTYPE;
  v_was_invited boolean;
  v_audit       uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('guardian', 'child') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_corrected_by, '')) = '' OR btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'actor_and_reason_required' USING ERRCODE = '22023';
  END IF;

  -- Row locks: a claim running at the same moment either lands first (and
  -- this refuses as already_claimed) or waits and then no longer matches.
  SELECT * INTO v_child FROM public.roster_children WHERE id = p_roster_child_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_on_roster' USING ERRCODE = 'P0002';
  END IF;

  IF p_kind = 'child' THEN
    -- TRAK-84: a child without an email signs in with a guardian-made username.
    IF v_child.child_email IS NULL THEN
      RAISE EXCEPTION 'no_child_email' USING ERRCODE = '22023';
    END IF;
    IF v_child.child_email <> v_old THEN
      RAISE EXCEPTION 'not_on_roster' USING ERRCODE = 'P0002';
    END IF;
    IF v_child.player_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'already_claimed' USING ERRCODE = '55000';
    END IF;
    v_was_invited := v_child.invited_at IS NOT NULL;
  ELSE
    SELECT * INTO v_guardian FROM public.roster_guardians
    WHERE roster_child_id = v_child.id AND email = v_old FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_on_roster' USING ERRCODE = 'P0002';
    END IF;
    IF v_guardian.parent_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'already_claimed' USING ERRCODE = '55000';
    END IF;
    v_was_invited := v_guardian.invited_at IS NOT NULL;
  END IF;

  IF v_new = v_old THEN
    RAISE EXCEPTION 'unchanged' USING ERRCODE = '22023';
  END IF;
  IF v_new !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  -- The same rules as admit_roster_child: on one child an address is either
  -- the child's or one guardian's; and a child address is unique.
  IF v_child.child_email = v_new
     OR EXISTS (SELECT 1 FROM public.roster_guardians WHERE roster_child_id = v_child.id AND email = v_new)
     OR (p_kind = 'child' AND EXISTS (SELECT 1 FROM public.roster_children WHERE child_email = v_new))
  THEN
    RAISE EXCEPTION 'email_in_use' USING ERRCODE = '23505';
  END IF;

  -- invited_at is cleared so a re-invite reaches the new address; invite_count
  -- keeps the history of what went to the old one.
  IF p_kind = 'child' THEN
    UPDATE public.roster_children SET child_email = v_new, invited_at = NULL WHERE id = v_child.id;
  ELSE
    UPDATE public.roster_guardians SET email = v_new, invited_at = NULL WHERE id = v_guardian.id;
  END IF;

  INSERT INTO public.roster_email_corrections
    (roster_child_id, kind, roster_guardian_id, corrected_by, reason,
     old_email_sha256, new_email_sha256, was_invited)
  VALUES
    (v_child.id, p_kind, v_guardian.id, btrim(p_corrected_by), btrim(p_reason),
     encode(sha256(convert_to(v_old, 'UTF8')), 'hex'),
     encode(sha256(convert_to(v_new, 'UTF8')), 'hex'),
     v_was_invited)
  RETURNING id INTO v_audit;

  RETURN v_audit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.correct_roster_email(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_roster_email(uuid, text, text, text, text, text) TO service_role;

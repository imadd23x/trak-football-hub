-- ============================================================
-- TRAK-49 [J1]: the academy roster, as Trak loads it by hand
--
-- MVP Requirements J1: "The academy gives Trak its roster: child name, date
-- of birth, age group, assigned coach, child email and every guardian email.
-- Trak loads it by hand." Until now none of that had anywhere to live except
-- what the child typed at signup, which is the G2 defect Tarek's audit found:
-- a child chooses their guardian's email and their own date of birth.
--
-- Two tables, not columns on squad_players:
--   * squad_players is read by coaches, linked players and academy admins,
--     and coaches hold UPDATE on it. Child email, date of birth and guardian
--     emails there would be visible to coaches and editable by them.
--   * Guardians are one-to-many per child, and one guardian can cover
--     siblings (J2), so a column does not fit.
--
-- squad_players stays the coach-facing row (name, age group, coach). The
-- roster row points at it and holds what only the admission path may read.
--
-- Access: RLS on, no policies, nothing granted to anon or authenticated.
-- The operator loads through service_role; the admission functions that read
-- these tables (TRAK-48 slice 3, TRAK-18) are SECURITY DEFINER.
--
-- What this does not do yet, on purpose: refuse unrostered profiles
-- (TRAK-48 slice 3), stop a child choosing a guardian email (TRAK-18), or
-- send invitations at admission (J2). Each builds on these tables.
-- ============================================================

CREATE TABLE public.roster_children (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Both cascade, like every other reference to squad_players, so account
  -- deletion keeps working once a child is admitted: delete_my_account()
  -- removes a player's linked squad row and an academy admin's organization.
  -- A child who erases their account therefore erases their admission too;
  -- the academy re-loads them if they come back. A coach cannot trigger the
  -- cascade: see refuse_app_delete_of_rostered_squad_row() below.
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  squad_player_id uuid NOT NULL UNIQUE REFERENCES public.squad_players(id) ON DELETE CASCADE,
  date_of_birth   date NOT NULL,
  child_email     text NOT NULL,
  player_user_id  uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  loaded_by       text NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now(),
  source_file     text,
  -- Stored normalized, so every comparison is plain equality and the unique
  -- index below cannot be sidestepped by case or whitespace.
  CONSTRAINT roster_children_email_normalized
    CHECK (child_email = lower(btrim(child_email))),
  CONSTRAINT roster_children_email_shape
    CHECK (child_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  CONSTRAINT roster_children_dob_plausible
    CHECK (date_of_birth > DATE '1990-01-01'),
  CONSTRAINT roster_children_loaded_by_named
    CHECK (btrim(loaded_by) <> '')
);

-- One address, one child, across every academy: an invitation to that
-- address can only ever mean one child (G5).
CREATE UNIQUE INDEX roster_children_child_email_key
  ON public.roster_children (child_email);
CREATE INDEX roster_children_organization_idx
  ON public.roster_children (organization_id);

CREATE TABLE public.roster_guardians (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_child_id uuid NOT NULL REFERENCES public.roster_children(id) ON DELETE CASCADE,
  email           text NOT NULL,
  -- Confirmed by the guardian at consent, not trusted from the file.
  relationship    text CHECK (relationship IN ('parent', 'legal_guardian')),
  parent_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  loaded_by       text NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_guardians_email_normalized
    CHECK (email = lower(btrim(email))),
  CONSTRAINT roster_guardians_email_shape
    CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  CONSTRAINT roster_guardians_loaded_by_named
    CHECK (btrim(loaded_by) <> ''),
  -- The same guardian may appear on several children (siblings), once each.
  CONSTRAINT roster_guardians_child_email_key UNIQUE (roster_child_id, email)
);

CREATE INDEX roster_guardians_email_idx ON public.roster_guardians (email);

ALTER TABLE public.roster_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_guardians ENABLE ROW LEVEL SECURITY;

-- Born with nothing since 20260919120001; stated anyway, because a later
-- default-privilege change must not quietly open these two.
REVOKE ALL ON TABLE public.roster_children, public.roster_guardians FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.roster_children, public.roster_guardians TO service_role;


-- ── Invariants a CHECK cannot express ───────────────────────
-- A child's address and a guardian's address never coincide, anywhere on the
-- roster. Otherwise a consent request can land in the child's own inbox (G2,
-- G5). Advisory-locked on the address so two concurrent loads cannot each
-- pass the check and then both commit.
CREATE OR REPLACE FUNCTION public.roster_email_roles_disjoint()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  -- Through jsonb, because plpgsql resolves NEW.<field> against whichever
  -- table fired the trigger, and each table names the column differently.
  v_email text := to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'roster_children' THEN 'child_email' ELSE 'email' END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('trak.roster_email:' || v_email, 0));
  IF TG_TABLE_NAME = 'roster_children' THEN
    IF EXISTS (SELECT 1 FROM public.roster_guardians g WHERE g.email = v_email) THEN
      RAISE EXCEPTION 'A child''s email cannot also be a guardian''s email on the roster'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.roster_children c WHERE c.child_email = v_email) THEN
      RAISE EXCEPTION 'A guardian''s email cannot also be a child''s email on the roster'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER roster_children_email_roles_disjoint
  BEFORE INSERT OR UPDATE OF child_email ON public.roster_children
  FOR EACH ROW EXECUTE FUNCTION public.roster_email_roles_disjoint();
CREATE TRIGGER roster_guardians_email_roles_disjoint
  BEFORE INSERT OR UPDATE OF email ON public.roster_guardians
  FOR EACH ROW EXECUTE FUNCTION public.roster_email_roles_disjoint();

-- The roster row and the coach-facing squad row name the same academy, so a
-- load cannot admit a child into one academy while seating them in another's
-- squad (G3).
CREATE OR REPLACE FUNCTION public.roster_child_matches_squad_academy()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.squad_players sp
    WHERE sp.id = NEW.squad_player_id
      AND sp.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'The squad row must belong to the same academy as the roster entry'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER roster_children_matches_squad_academy
  BEFORE INSERT OR UPDATE OF organization_id, squad_player_id ON public.roster_children
  FOR EACH ROW EXECUTE FUNCTION public.roster_child_matches_squad_academy();

-- Trigger functions are not callable as RPCs.
REVOKE ALL ON FUNCTION public.roster_email_roles_disjoint() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roster_child_matches_squad_academy() FROM PUBLIC, anon, authenticated;

-- ── A coach cannot un-admit a child (J1, TRAK-62) ───────────
-- Coaches hold DELETE on their own squad rows ("Coaches can delete own squad
-- players"). With the cascade above, deleting a rostered child's squad row
-- would silently delete the academy's admission. J1: only the concierge
-- roster adds or removes children. So a rostered row can be deleted only by
-- the operator (service_role, no signed-in user) or by the child's own
-- account erasure (delete_my_account(), signed in as that child). Any other
-- signed-in request is refused, whether it comes straight from the app or
-- through a SECURITY DEFINER function the coach calls.
CREATE OR REPLACE FUNCTION public.refuse_app_delete_of_rostered_squad_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM OLD.linked_player_id
     AND EXISTS (SELECT 1 FROM public.roster_children rc WHERE rc.squad_player_id = OLD.id) THEN
    RAISE EXCEPTION 'This player was admitted by the academy. Ask Trak to remove them from the roster.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$fn$;

CREATE TRIGGER squad_players_refuse_app_delete_of_rostered
  BEFORE DELETE ON public.squad_players
  FOR EACH ROW EXECUTE FUNCTION public.refuse_app_delete_of_rostered_squad_row();

REVOKE ALL ON FUNCTION public.refuse_app_delete_of_rostered_squad_row() FROM PUBLIC, anon, authenticated;

-- ── The operator's load, one child at a time ────────────────
-- Creates the coach-facing squad row, the roster row and every guardian row
-- in one statement, so a failed row leaves nothing half-admitted. The squad
-- row takes its academy from the coach (20260920152925), and the coach must
-- already work for the academy named here: the operator states both, and the
-- database checks they agree. service_role only; scripts/load-roster.mjs is
-- the caller.
CREATE OR REPLACE FUNCTION public.admit_roster_child(
  p_organization_id uuid,
  p_coach_user_id   uuid,
  p_child_name      text,
  p_age_group       text,
  p_date_of_birth   date,
  p_child_email     text,
  p_guardian_emails text[],
  p_loaded_by       text,
  p_source_file     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_child_email text := lower(btrim(COALESCE(p_child_email, '')));
  v_guardians   text[];
  v_squad_id    uuid;
  v_roster_id   uuid;
BEGIN
  IF btrim(COALESCE(p_child_name, '')) = '' THEN
    RAISE EXCEPTION 'The child''s name is required' USING ERRCODE = '22023';
  END IF;
  IF p_date_of_birth IS NULL THEN
    RAISE EXCEPTION 'The child''s date of birth is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.coach_details cd
    WHERE cd.user_id = p_coach_user_id AND cd.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'The coach does not work for this academy' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT e), '{}') INTO v_guardians
  FROM (SELECT lower(btrim(g)) AS e FROM unnest(COALESCE(p_guardian_emails, '{}')) g) s
  WHERE e <> '';
  IF cardinality(v_guardians) = 0 THEN
    RAISE EXCEPTION 'At least one guardian email is required' USING ERRCODE = '22023';
  END IF;
  IF v_child_email = ANY (v_guardians) THEN
    RAISE EXCEPTION 'A child''s email cannot also be a guardian''s email on the roster'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.squad_players (coach_user_id, player_name, age_group)
  VALUES (p_coach_user_id, btrim(p_child_name), NULLIF(btrim(COALESCE(p_age_group, '')), ''))
  RETURNING id INTO v_squad_id;

  INSERT INTO public.roster_children
    (organization_id, squad_player_id, date_of_birth, child_email, loaded_by, source_file)
  VALUES (p_organization_id, v_squad_id, p_date_of_birth, v_child_email, p_loaded_by, p_source_file)
  RETURNING id INTO v_roster_id;

  INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by)
  SELECT v_roster_id, e, p_loaded_by FROM unnest(v_guardians) e;

  RETURN v_roster_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admit_roster_child(uuid, uuid, text, text, date, text, text[], text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_roster_child(uuid, uuid, text, text, date, text, text[], text, text)
  TO service_role;

COMMENT ON TABLE public.roster_children IS
  'TRAK-49 J1: children admitted from the academy roster, loaded by an operator. No app-role access; read only by SECURITY DEFINER admission functions.';
COMMENT ON TABLE public.roster_guardians IS
  'TRAK-49 J1/J2: academy-supplied guardian emails per rostered child. The only source of guardian addresses for invitations.';

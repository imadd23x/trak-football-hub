-- ============================================================
-- F6: a club admin cannot delete their own account at all.
--
-- Tarek demonstrated it in #47 and deliberately left the assertions failing,
-- because the referential behaviour is a decision rather than a guess. Both
-- triggers involved are mine (K1's pin_org_id_on_update, K2/20260917000003's
-- set_squad_player_org_id), so this is the decision, written down.
--
--   a club admin can delete their own account
--     -> 23503: insert or update on table "squad_players"
--        violates foreign key constraint
--
-- Not "leaves rows behind". It raises, the transaction rolls back, and the
-- account survives. GDPR erasure is unavailable to one of the four roles.
--
-- ── Mechanism
--
-- delete_my_account() does, for a club admin:
--
--   DELETE FROM public.organizations WHERE admin_user_id = v_uid;
--
-- Every organization_id column is `REFERENCES organizations(id) ON DELETE SET
-- NULL`, so Postgres issues the referential UPDATE itself:
--
--   UPDATE squad_players     SET organization_id = NULL WHERE ...
--   UPDATE coach_assessments SET organization_id = NULL WHERE ...
--   UPDATE recognition_awards SET organization_id = NULL WHERE ...
--
-- Those are UPDATEs, so my BEFORE UPDATE triggers fire and put the value back:
--
--   NEW.organization_id := OLD.organization_id;
--
-- The FK then finds a row still pointing at an organisation that no longer
-- exists, and raises. The trigger is not merely blocking the cleanup — it is
-- resurrecting a dangling reference and failing the constraint that asked for
-- it to be cleared.
--
-- ── The decision
--
-- The pin exists to stop history moving between academies: an assessment
-- written at academy A must not become academy B's record, and a coach must
-- not be able to quietly detach a record from the academy that employed them.
-- Both of those remain refused. Two transitions are carved out, and only two:
--
--   1. NULL -> an academy.  Nothing is rewritten; a record that belonged to
--      no academy is being attributed for the first time. This is what a coach
--      joining an academy after signup needs, and 20260917000003 already
--      decided it for squad_players. It was never decided for assessments or
--      awards, which is why 5 of 134 live assessments are stranded with no
--      academy and would have stayed that way permanently.
--
--   2. An academy -> NULL, ONLY when that organisation no longer exists.
--      This is the FK's own ON DELETE SET NULL and nothing else can produce
--      it: while the organisation exists the pin still refuses, so a coach
--      cannot hide a record by clearing its academy. The academy has been
--      deleted; there is no history left to protect and no academy left to
--      protect it from.
--
-- A lateral move (academy A -> academy B) stays refused, which is the case the
-- pin was written for.
--
-- ── Why the existence check and not a flag
--
-- A session variable or a "we are deleting" flag would work and would be
-- worse: it can be set by anything that knows the name, and it makes the
-- trigger's behaviour depend on state no reader of the row can see. Asking
-- whether the organisation still exists is a question about the database, it
-- cannot be spoofed by a caller, and it is true exactly when the FK action is
-- what issued the update.
-- ============================================================

-- ── 1. coach_assessments and recognition_awards ─────────────

CREATE OR REPLACE FUNCTION public.pin_org_id_on_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Carve-out 1: the row carried no academy. Attributing it for the first
  -- time rewrites nothing. Adopt the coach's current academy, matching what
  -- set_squad_player_org_id() has done for roster rows since 20260917000003,
  -- so an assessment written before the coach joined is picked up rather than
  -- stranded for good.
  IF OLD.organization_id IS NULL THEN
    IF NEW.coach_user_id IS NOT NULL THEN
      SELECT cd.organization_id INTO NEW.organization_id
      FROM public.coach_details cd
      WHERE cd.user_id = NEW.coach_user_id;
    ELSE
      NEW.organization_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Carve-out 2: the academy is gone. Let the FK's ON DELETE SET NULL through.
  IF NEW.organization_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id)
  THEN
    RETURN NEW;
  END IF;

  -- Everything else is pinned, including a lateral A -> B and a clearing of an
  -- academy that still exists.
  NEW.organization_id := OLD.organization_id;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.pin_org_id_on_update() IS
  'Keeps a record with the academy it was created under. Permits exactly two changes: first attribution from NULL, and the FK ON DELETE SET NULL when the organisation has been deleted (without which a club admin cannot delete their own account — F6). A lateral move between academies stays refused.';


-- ── 2. squad_players ────────────────────────────────────────
-- Same carve-out 2. 20260917000003 already allowed NULL -> academy here; it
-- refused academy -> NULL unconditionally, which is the branch that raises
-- 23503 and names squad_players in Tarek's failure.

CREATE OR REPLACE FUNCTION public.set_squad_player_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- The academy has been deleted: the FK is clearing the reference, and
  -- putting it back is what fails the constraint.
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id)
  THEN
    RETURN NEW;
  END IF;

  -- An academy already recorded on the row is otherwise final: never
  -- reassigned, never cleared. This is what keeps a transferred coach from
  -- carrying their old squad, and a deleted coach's players with their academy.
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL THEN
    NEW.organization_id := OLD.organization_id;

  -- No academy on the row yet: take the one from the coach who holds it.
  ELSIF NEW.coach_user_id IS NOT NULL THEN
    SELECT cd.organization_id INTO NEW.organization_id
    FROM public.coach_details cd
    WHERE cd.user_id = NEW.coach_user_id;

  -- No academy and no coach: nothing to infer.
  ELSE
    NEW.organization_id := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.set_squad_player_org_id() IS
  'Stamps a roster row with its coach''s academy and keeps it there. Permits first attribution from NULL, and the FK ON DELETE SET NULL when the organisation has been deleted (F6). A lateral move between academies stays refused.';


-- ── 3. The rows already stranded ────────────────────────────
--
-- The trigger change fixes the future. It does not move the 5 assessments
-- written before their coach joined an academy, because nothing will update
-- them: an assessment is written once and read thereafter.
--
-- Attributed only where the coach still holds an academy today. A departed
-- coach (coach_user_id NULL after delete_my_account anonymises them) has no
-- academy to attribute from, and guessing one would put a child's assessment
-- into an academy that may never have employed them.
UPDATE public.coach_assessments a
SET organization_id = cd.organization_id
FROM public.coach_details cd
WHERE a.organization_id IS NULL
  AND a.coach_user_id = cd.user_id
  AND cd.organization_id IS NOT NULL;

UPDATE public.recognition_awards r
SET organization_id = cd.organization_id
FROM public.coach_details cd
WHERE r.organization_id IS NULL
  AND r.coach_user_id = cd.user_id
  AND cd.organization_id IS NOT NULL;

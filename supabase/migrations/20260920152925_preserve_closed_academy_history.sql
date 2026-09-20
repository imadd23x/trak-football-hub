-- Converge #34 and #44 without modifying either published migration.
-- A closed academy's history is not an independent coach's new roster.
-- An existing marker plus a live academy reference is ambiguous: the previous
-- trigger could have reassigned history or allowed a forged marker. Refuse to
-- guess provenance. Such rows require an explicitly reviewed repair manifest.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.squad_players s
    WHERE s.organization_deleted_at IS NOT NULL
      AND (s.organization_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.coach_assessments a
                   WHERE a.squad_player_id=s.id AND a.organization_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.recognition_awards r
                   WHERE r.squad_player_id=s.id AND r.organization_id IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Closed-academy history has ambiguous academy references; reviewed repair required'
      USING ERRCODE='23514';
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.pin_org_id_on_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Both trigger-bearing tables retain a NOT NULL roster FK (ON DELETE
  -- CASCADE). Its protected closure marker distinguishes closed history from
  -- a genuinely unattributed record. Always inspect the OLD roster identity.
  IF EXISTS (
    SELECT 1 FROM public.squad_players s
    WHERE s.id=OLD.squad_player_id AND s.organization_deleted_at IS NOT NULL
  ) THEN
    IF NEW.squad_player_id IS DISTINCT FROM OLD.squad_player_id THEN
      RAISE EXCEPTION 'Closed academy history cannot move to another player'
        USING ERRCODE='42501';
    END IF;
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  -- Preserve #44's first-attribution behavior for records that were not
  -- closed-academy history. Do not accept a caller-selected academy UUID.
  IF OLD.organization_id IS NULL THEN
    IF NEW.coach_user_id IS NOT NULL THEN
      SELECT cd.organization_id INTO NEW.organization_id
      FROM public.coach_details cd WHERE cd.user_id=NEW.coach_user_id;
    ELSE
      NEW.organization_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Real FK cleanup is allowed only after the referenced academy is absent.
  IF NEW.organization_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=OLD.organization_id) THEN
    RETURN NEW;
  END IF;
  NEW.organization_id := OLD.organization_id;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_squad_player_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.organization_deleted_at := OLD.organization_deleted_at;
    IF OLD.organization_deleted_at IS NOT NULL THEN
      NEW.organization_id := NULL;
      NEW.status := 'coach_departed';
      IF NEW.linked_player_id IS NOT NULL
         AND NEW.linked_player_id IS DISTINCT FROM OLD.linked_player_id THEN
        RAISE EXCEPTION 'Closed academy history cannot be linked to a new player'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    -- Clients cannot create, forge or clear the deletion marker.
    NEW.organization_deleted_at := NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL THEN
    IF NEW.organization_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
      -- Deleted-academy records are history, not independent-coach records.
      -- Otherwise the NULL-organization branch in ownership policies would
      -- restore access to a removed/transferred coach, notably released rows.
      NEW.status := 'coach_departed';
      NEW.organization_deleted_at := now();
      RETURN NEW;
    END IF;
    NEW.organization_id := OLD.organization_id;
  ELSIF NEW.coach_user_id IS NOT NULL THEN
    -- Preserve NULL -> academy adoption for genuine independent/orphan rows.
    SELECT cd.organization_id INTO NEW.organization_id
    FROM public.coach_details cd
    WHERE cd.user_id = NEW.coach_user_id;
  ELSE
    NEW.organization_id := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;


-- Existing marked rows may have had their status changed by #44's replacement
-- trigger. Close them again without moving their identity or inventing an org.
UPDATE public.squad_players
SET status='coach_departed'
WHERE organization_deleted_at IS NOT NULL AND status IS DISTINCT FROM 'coach_departed';

COMMENT ON FUNCTION public.pin_org_id_on_update() IS
  'Pins recorded academy history; permits genuine first attribution and real FK cleanup, but never adopts closed-academy history or retargets it to another roster identity.';
COMMENT ON FUNCTION public.set_squad_player_org_id() IS
  'Pins roster academy identity; marks closed-academy history and prevents reactivation or identity reassignment, while retaining genuine first attribution and FK cleanup.';
REVOKE ALL ON FUNCTION public.pin_org_id_on_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_squad_player_org_id() FROM PUBLIC, anon, authenticated, service_role;

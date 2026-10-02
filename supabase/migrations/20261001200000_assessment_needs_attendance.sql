-- TRAK-100 (J5), acceptance 3 (Imad, 1 Oct): the database refuses an
-- assessment on a session where the player isn't marked present. The picker
-- (#211) already offers only attended sessions; this holds for a quick-assess
-- screen, an old cached app or a direct API call too. In the TRAK-24 rerun an
-- assessment landed on a same-name session with no attendance at all, and the
-- child's history showed it there.
--
-- Scope, so existing data stays as it is:
-- * An assessment with no session is left alone: the 56 seed assessments from
--   before TRAK-68 have none, and so do their edits.
-- * An edit that keeps the session and the player is left alone, so an
--   assessment saved before this rule still opens and saves in place.
-- * "Present" means status 'present', the only status the app writes.
--
-- The other half: once a player is assessed on a session, their attendance
-- there can't be removed or changed away from present (TRAK-102 will let
-- coaches edit attendance). Deleting the session or the squad row still
-- cascades as before; the assessment then keeps no session, or goes with it.
--
-- Both run for every role, the operator too. AFTER and without UPDATE OF, so
-- they see the final row; raising rolls back the whole statement. DEFINER so
-- the check reads attendance and assessments whatever the caller's RLS shows.

CREATE OR REPLACE FUNCTION trak_private.require_assessed_player_present()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.session_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
     AND NEW.squad_player_id IS NOT DISTINCT FROM OLD.squad_player_id THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.session_attendance sa
    WHERE sa.session_id = NEW.session_id
      AND sa.squad_player_id = NEW.squad_player_id
      AND sa.status = 'present'
  ) THEN
    RAISE EXCEPTION 'This player is not marked present at that session'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION trak_private.require_assessed_player_present()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_assessed_player_present ON public.coach_assessments;
CREATE TRIGGER trg_assessed_player_present AFTER INSERT OR UPDATE ON public.coach_assessments
  FOR EACH ROW EXECUTE FUNCTION trak_private.require_assessed_player_present();

CREATE OR REPLACE FUNCTION trak_private.keep_assessed_attendance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.status IS DISTINCT FROM 'present' THEN
    RETURN NULL;
  END IF;
  -- A cascade from deleting the session or the squad row: the parent is
  -- already gone, so there is no attendance left to protect.
  IF NOT EXISTS (SELECT 1 FROM public.coach_sessions s WHERE s.id = OLD.session_id)
     OR NOT EXISTS (SELECT 1 FROM public.squad_players p WHERE p.id = OLD.squad_player_id) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.coach_assessments a
       WHERE a.session_id = OLD.session_id AND a.squad_player_id = OLD.squad_player_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.session_attendance sa
       WHERE sa.session_id = OLD.session_id
         AND sa.squad_player_id = OLD.squad_player_id
         AND sa.status = 'present') THEN
    RAISE EXCEPTION 'A player assessed on this session must stay marked present'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION trak_private.keep_assessed_attendance()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_keep_assessed_attendance ON public.session_attendance;
CREATE TRIGGER trg_keep_assessed_attendance AFTER UPDATE OR DELETE ON public.session_attendance
  FOR EACH ROW EXECUTE FUNCTION trak_private.keep_assessed_attendance();

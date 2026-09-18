-- ============================================================
-- Follow-up to 20260917000002. A roster row that has no academy can
-- never acquire one.
--
-- set_squad_player_org_id() pins organization_id on every UPDATE:
--
--   IF TG_OP = 'UPDATE' THEN
--     NEW.organization_id := OLD.organization_id;
--
-- The intent was right — a roster row must never move between academies,
-- which is the transfer leak that migration closed. But pinning
-- unconditionally also pins NULL, so a row that starts without an academy
-- keeps that state forever.
--
-- That state is reachable and already exists. squad_players_coach_user_id_fkey
-- is ON DELETE SET NULL, so deleting a coach orphans their roster rows; the
-- backfill in 20260917000002 correctly skipped the one such row in the live
-- database (62 of 63 stamped) because there was no coach and no assessment to
-- infer an academy from. If a coach later adopts that row, it stays NULL and
-- the academy never sees the player — a child silently missing from the squad
-- the academy is paying to look at, with nothing anywhere reporting it.
--
-- Fix: pin only a real academy. A NULL may still be filled from the coach on
-- the row, which is the same rule INSERT already uses. A row that has an
-- academy is still immovable, so the transfer leak stays closed:
--
--   NULL  -> academy   allowed (adoption, and repair of an orphan)
--   A     -> A         allowed (no change)
--   A     -> B         refused (pinned to A)
--   A     -> NULL      refused (pinned to A; the academy keeps the record
--                      when its coach is deleted)
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_squad_player_org_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- An academy already recorded on the row is final: never reassigned, never
  -- cleared. This is what keeps a transferred coach from carrying their old
  -- squad, and what keeps a deleted coach's players with their academy.
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL THEN
    NEW.organization_id := OLD.organization_id;

  -- No academy on the row yet: take the one from the coach who holds it.
  -- Covers a fresh insert, a coach adopting an orphaned row, and repairing a
  -- row that was orphaned and has since been picked up.
  ELSIF NEW.coach_user_id IS NOT NULL THEN
    SELECT cd.organization_id INTO NEW.organization_id
    FROM public.coach_details cd
    WHERE cd.user_id = NEW.coach_user_id;

  -- No academy and no coach: nothing to infer. An unowned roster row belongs
  -- to no academy, and squad_player_in_my_org() already returns false for a
  -- NULL, so it stays invisible to every club admin rather than visible to all.
  ELSE
    NEW.organization_id := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

-- Repair any row that already has a coach but no academy. There are none in
-- the live database today — the single unstamped row has no coach — but a row
-- orphaned and re-adopted between 20260917000002 and this migration would sit
-- in exactly this state, and the statement is a no-op when there are none.
UPDATE public.squad_players sp
SET organization_id = cd.organization_id
FROM public.coach_details cd
WHERE cd.user_id = sp.coach_user_id
  AND sp.organization_id IS NULL
  AND cd.organization_id IS NOT NULL;

-- TRAK-13 (G6) read side, for TRAK-6 (J6). One consent covers "coach records,
-- assessments, the published message, and viewing by the child and their
-- linked parents" (MVP J2), and withdrawal "hides published content
-- immediately" (G6). The published message and training history already
-- follow consent; the family SELECT policies on coach_assessments,
-- recognition_awards and matches did not (checked on production 27 Sep: after
-- a withdrawal the child and parent still read every assessment).
--
-- A RESTRICTIVE policy per table hides a row from the child and their linked
-- parents while that under-18 needs consent. Coaches and academy admins keep
-- reading their own records (the permissive policies still decide who sees
-- what). A player's own self-logged matches stay theirs. Withdrawal hides; it
-- deletes nothing, and a new consent shows the records again.

-- True when the caller is the child on this squad row, or a parent linked to
-- them, and that child needs consent they don't have.
CREATE OR REPLACE FUNCTION trak_private.family_read_blocked(p_player_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT p_player_user_id IS NOT NULL
    AND (p_player_user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.player_parent_links ppl
                    WHERE ppl.player_user_id = p_player_user_id AND ppl.parent_user_id = auth.uid()))
    AND public.player_consent_required(p_player_user_id);
$fn$;
REVOKE ALL ON FUNCTION trak_private.family_read_blocked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.family_read_blocked(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION trak_private.family_read_blocked(uuid) IS
  'RLS-only: the caller is this child or their linked parent, and the child lacks required consent (G6).';

CREATE OR REPLACE FUNCTION trak_private.family_read_blocked_for_squad_player(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT coalesce(
    (SELECT trak_private.family_read_blocked(sp.linked_player_id)
     FROM public.squad_players sp WHERE sp.id = p_squad_player_id),
    false);
$fn$;
REVOKE ALL ON FUNCTION trak_private.family_read_blocked_for_squad_player(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.family_read_blocked_for_squad_player(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION trak_private.family_read_blocked_for_squad_player(uuid) IS
  'RLS-only: family_read_blocked for the child linked to this squad row (G6).';

DROP POLICY IF EXISTS "Family reads assessments only with consent" ON public.coach_assessments;
CREATE POLICY "Family reads assessments only with consent" ON public.coach_assessments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT trak_private.family_read_blocked_for_squad_player(squad_player_id));

DROP POLICY IF EXISTS "Family reads awards only with consent" ON public.recognition_awards;
CREATE POLICY "Family reads awards only with consent" ON public.recognition_awards
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT trak_private.family_read_blocked_for_squad_player(squad_player_id));

-- Only a match the player logged themselves stays visible without consent.
-- Anything else (the coach's record, or an unlabelled row) follows consent.
DROP POLICY IF EXISTS "Family reads coach-logged matches only with consent" ON public.matches;
CREATE POLICY "Family reads coach-logged matches only with consent" ON public.matches
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (logged_by_role = 'player' OR NOT trak_private.family_read_blocked(user_id));

-- Players may edit their own match rows, so without this a child could
-- relabel the coach's record as self-logged and keep it after a withdrawal.
-- Who logged a match is fixed at insert (stamp_match_actor). SECURITY INVOKER,
-- so trusted SECURITY DEFINER paths and the operator are unaffected.
CREATE OR REPLACE FUNCTION public.keep_match_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.logged_by := OLD.logged_by;
    NEW.logged_by_role := OLD.logged_by_role;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.keep_match_actor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS keep_match_actor_trg ON public.matches;
CREATE TRIGGER keep_match_actor_trg
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.keep_match_actor();

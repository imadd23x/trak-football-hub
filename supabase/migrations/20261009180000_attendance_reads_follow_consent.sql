-- TRAK-147 (G6): attendance follows consent, like the other coach records.
-- "Players can read own attendance" had no consent check, so a child whose
-- consent was withdrawn still read their own rows straight from the table
-- (Codex audit, 9 Oct; family_training_history() already refused). This is
-- the same restrictive rule 20260927130000 puts on assessments, awards and
-- coach-logged matches: the child and their linked parents read nothing while
-- that under-18 needs consent. Coaches keep reading; withdrawal hides and
-- deletes nothing, so a new consent shows the rows again.

DROP POLICY IF EXISTS "Family reads attendance only with consent" ON public.session_attendance;
CREATE POLICY "Family reads attendance only with consent" ON public.session_attendance
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT trak_private.family_read_blocked_for_squad_player(squad_player_id));

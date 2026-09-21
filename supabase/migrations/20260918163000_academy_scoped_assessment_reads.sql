-- ============================================================
-- K7: a squad band reflects the academy's latest assessment, not only the
-- signed-in coach's own.
--
-- CoachSquadPage derives each player's band from coach_assessments, but the
-- only read policy is "Coaches can select own assessments":
--
--   EXISTS (SELECT 1 FROM coach_assessments ca
--           WHERE ca.id = ... AND ca.coach_user_id = auth.uid())
--
-- So a colleague's assessment is invisible, and the band disappears from the
-- squad list even though the player has been assessed. Dropping the frontend's
-- .eq('coach_user_id', ...) achieves nothing on its own — the policy is the
-- constraint, not the query.
--
-- Latent at the time of writing: 134 assessments, 0 made by a coach other than
-- the roster row's owner. But the pilot runs three coaches per academy, K2
-- explicitly supports transferring a roster row between coaches, and the point
-- of an academy record is that it survives a coach change.
--
-- ── Additive, never narrowing
--
-- RLS policies are OR'd. The existing own-assessments policy is untouched, so
-- a coach keeps reading everything they could read before — including rows on
-- roster entries that carry no academy.
--
-- ── Why not squad_player_in_my_org()
--
-- Because it is not a coach helper, despite the name. It resolves through
-- my_organization_id(), which is `organizations.admin_user_id = auth.uid()` —
-- the CLUB ADMIN's organisation. For a coach it returns NULL, so reusing it
-- here would have produced a policy that silently grants nothing. The helper
-- below says `coach` in its name for exactly that reason.
--
-- ── A departed coach gains nothing
--
-- The real risk in an org-scoped read is widening access for someone who has
-- left. remove_coach_from_org() sets coach_details.organization_id = NULL, so
-- my_coach_organization_id() returns NULL for a departed coach and the
-- predicate below can never match. U8 holds by construction rather than by a
-- second check that could drift out of step.
--
-- ── Roster rows with no academy stay coach-only
--
-- 6 of 73 rows have organization_id NULL. The helper requires NOT NULL, so
-- they remain visible only to their owning coach. Attributing an unattributed
-- row to an academy is the wrong direction to be wrong in.
-- ============================================================

-- Distinct from squad_player_in_my_org(uuid), which takes an organization_id
-- and resolves the CLUB ADMIN's organisation. This one takes a squad_player id
-- and resolves the signed-in COACH's organisation.
CREATE OR REPLACE FUNCTION public.squad_player_in_my_coach_org(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.squad_players sp
    WHERE sp.id = p_squad_player_id
      -- Explicit, not load-bearing, and the distinction matters. SQL's
      -- three-valued logic already refuses a NULL match: `NULL = NULL` is
      -- NULL, not true, so an unattributed roster row and a coach with no
      -- academy would not match even without this line. I first wrote a
      -- comment claiming otherwise; a mutation that removed the guard and
      -- changed nothing is what exposed it.
      --
      -- It stays because it states the intent at the point of the rule, and
      -- because a later rewrite to IS NOT DISTINCT FROM — which DOES treat
      -- two NULLs as equal — would otherwise silently grant every coach
      -- without an academy access to every unattributed roster row.
      AND sp.organization_id IS NOT NULL
      AND sp.organization_id = public.my_coach_organization_id()
  );
$$;

COMMENT ON FUNCTION public.squad_player_in_my_coach_org(uuid) IS
  'True when the roster row belongs to the signed-in coach''s academy. Resolves the COACH''s organisation via coach_details, unlike squad_player_in_my_org(uuid) which resolves the club admin''s. Returns false for a departed coach, whose coach_details.organization_id is NULL.';

DROP POLICY IF EXISTS "Coaches read assessments in their academy" ON public.coach_assessments;
CREATE POLICY "Coaches read assessments in their academy"
  ON public.coach_assessments FOR SELECT TO authenticated
  USING (
    public.is_coach()
    AND public.squad_player_in_my_coach_org(coach_assessments.squad_player_id)
  );

-- Notes stay coach-private regardless. K9 made coach_assessment_notes readable
-- only by its own coach, and widening assessment READS must not drag the
-- private note along behind them: a colleague seeing a band is not a colleague
-- reading what the assessing coach wrote to themselves. No policy is added to
-- coach_assessment_notes here, which is the point worth stating explicitly.

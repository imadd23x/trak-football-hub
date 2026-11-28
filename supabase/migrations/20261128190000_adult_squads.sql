-- TRAK-630 (Imad, 28 Nov: option b): a coach-only adult club records for players who never use Trak.
--
-- A club whose players are all adults (a pro club's U23) uses Trak for its staff only. Trak names a squad
-- player and lets the coach record for them only once the player has an account and consent on record, so
-- every player without an account waits forever. A player with an account who is 18 or over already needs no
-- consent (consent_threshold_age, 20260921120000); the gap is that a roster row has no account to prove the age.
--
-- 'adult_squads' is one more academy_features row. In an academy with it on, a squad player with NO linked
-- account counts as consented when the roster says they are 18 or over. Under 18, or no age on the roster,
-- still waits. A squad player WITH an account follows the normal consent rules. 'demo' (20261128170000) is kept.
--
--   switch on:  INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'adult_squads');
-- It starts off for every academy. Only the founders switch it on, for a club whose squads are all adults, once
-- the club has signed the processing agreement and told its players (docs/pilot-runbook.md).
-- App roles can neither read nor change switches (20261008160000), so no coach or admin can turn it on.
-- ponytail: the age is the roster's, and a coach can edit it (UPDATE on squad_players.age). The switch is only
-- for a club that certifies every player on its rosters is an adult; if it is ever needed for a club with
-- under-18s, stop coaches changing the age while the switch is on.
--
-- One function changes, as in 20261128170000: every consent check goes through it. CREATE OR REPLACE keeps
-- the grants set in 20260921182442.

ALTER TABLE public.academy_features
  DROP CONSTRAINT academy_features_feature_check,
  ADD CONSTRAINT academy_features_feature_check
    CHECK (feature IN ('events', 'games', 'training', 'season_plan', 'family_look', 'tasks', 'announcements', 'demo',
                       'adult_squads'));

CREATE OR REPLACE FUNCTION public.squad_player_consent_required(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN sp.linked_player_id IS NOT NULL THEN public.player_consent_required(sp.linked_player_id)
    ELSE NOT EXISTS (
      SELECT 1 FROM public.academy_features f
      WHERE f.organization_id = sp.organization_id
        AND (f.feature = 'demo'
             OR (f.feature = 'adult_squads' AND sp.age >= public.consent_threshold_age()))
    )
  END
  FROM public.squad_players sp
  WHERE sp.id = p_squad_player_id;
$fn$;

-- TRAK-629 (Kostas, 28 Nov; Imad agreed "Obviously A"): a demo academy shows its squad by name.
--
-- A sales demo academy holds a coach's real squad but no player accounts. Trak names a squad player only once
-- the player has an account and consent on record, so the whole demo squad sat under "Waiting for consent".
--
-- 'demo' is one more academy_features row. In an academy with it on, a squad player with NO linked account
-- counts as consented: no family is linked, so nothing reaches anyone but the coach. A squad player WITH an
-- account follows the normal consent rules, even in a demo academy.
--
--   switch on:  INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'demo');
-- It starts off for every academy. Only for a demo academy the founders made; never for a real club.
-- App roles can neither read nor change switches (20261008160000), so no coach or admin can turn it on.
--
-- One function changes. Every consent check goes through it: the write policies (trak_private bridge),
-- coach_squad_player_consent_required, coach_squad_players_consent_pending (the squad page) and
-- coach_squad_player_wait_reason. CREATE OR REPLACE keeps the grants set in 20260921182442.

ALTER TABLE public.academy_features
  DROP CONSTRAINT academy_features_feature_check,
  ADD CONSTRAINT academy_features_feature_check
    CHECK (feature IN ('events', 'games', 'training', 'season_plan', 'family_look', 'tasks', 'announcements', 'demo'));

CREATE OR REPLACE FUNCTION public.squad_player_consent_required(p_squad_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN sp.linked_player_id IS NOT NULL THEN public.player_consent_required(sp.linked_player_id)
    ELSE NOT EXISTS (
      SELECT 1 FROM public.academy_features f
      WHERE f.organization_id = sp.organization_id AND f.feature = 'demo'
    )
  END
  FROM public.squad_players sp
  WHERE sp.id = p_squad_player_id;
$fn$;

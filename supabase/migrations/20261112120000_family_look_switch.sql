-- TRAK-441 (Imad, 12 Nov): the family app in the coach's look turns on per academy, like Games and Training did.
-- 'family_look' is one more academy_features row. Until every family slice has landed it is on for Rehearsal FC
-- only, so real families keep today's screens.
--
-- feature_on() finds the academy through coach_details, so it is always off for a player or a parent.
-- family_feature_on() answers the same question for a family: is the switch on for the academy of the signed-in
-- player, or of any child linked to the signed-in parent? It returns one yes/no about the caller's own academy;
-- no policy uses it, so it opens no read or write.

ALTER TABLE public.academy_features
  DROP CONSTRAINT academy_features_feature_check,
  ADD CONSTRAINT academy_features_feature_check CHECK (feature IN ('events', 'games', 'training', 'season_plan', 'family_look'));

CREATE FUNCTION public.family_feature_on(p_feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.squad_players sp
    JOIN public.academy_features f ON f.organization_id = sp.organization_id AND f.feature = p_feature
    WHERE sp.status <> 'coach_departed'
      AND (sp.linked_player_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.player_parent_links l
                      WHERE l.player_user_id = sp.linked_player_id AND l.parent_user_id = auth.uid()))
  );
$$;
REVOKE ALL ON FUNCTION public.family_feature_on(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_feature_on(text) TO authenticated;

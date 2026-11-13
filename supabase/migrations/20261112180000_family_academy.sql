-- TRAK-441 slice 2 (Imad, 12 Nov): the family side menu shows the child's academy, its name and logo, as the coach's
-- shows his. Families can't read public.organizations (only its admin and its coaches can), and that stays so: this
-- gives a player their own academy and a parent their child's, the name and the logo only. Read through the child's
-- current roster row, as family_feature_on reads the academy's switches; a row whose coach left gives nothing.
CREATE FUNCTION public.family_academy(p_child uuid)
RETURNS TABLE (name text, logo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT o.name, o.logo_url
  FROM public.squad_players sp
  JOIN public.organizations o ON o.id = sp.organization_id
  WHERE sp.linked_player_id = p_child
    AND sp.status <> 'coach_departed'
    AND (p_child = auth.uid() OR EXISTS (
      SELECT 1 FROM public.player_parent_links l WHERE l.player_user_id = p_child AND l.parent_user_id = auth.uid()))
  ORDER BY sp.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.family_academy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_academy(uuid) TO authenticated;

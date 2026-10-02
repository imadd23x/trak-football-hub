-- TRAK-84 J3 part 3. Safe usernames and a current guardian-authorized Auth
-- target. No password enters an application table or a function response.
CREATE FUNCTION public.my_child_credential_targets()
RETURNS TABLE(roster_child_id uuid, auth_user_id uuid, first_name text, username text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT rc.id,cl.auth_user_id,split_part(btrim(sp.player_name),' ',1),cl.username
 FROM public.child_logins cl
 JOIN public.roster_children rc ON rc.id=cl.roster_child_id
 JOIN public.squad_players sp ON sp.id=rc.squad_player_id
 JOIN auth.users child ON child.id=cl.auth_user_id
 WHERE child.email=cl.username||'@child.trakfootball.com'
   AND child.raw_app_meta_data->'trak_child_login'='true'::jsonb
   AND EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users guardian ON guardian.id=p.user_id
     WHERE p.user_id=auth.uid() AND p.role='parent' AND guardian.email_confirmed_at IS NOT NULL)
   AND (CASE WHEN rc.player_user_id IS NULL THEN
     EXISTS (SELECT 1 FROM public.roster_guardians rg WHERE rg.roster_child_id=rc.id AND rg.parent_user_id=auth.uid())
     ELSE rc.player_user_id=cl.auth_user_id AND EXISTS (SELECT 1 FROM public.player_parent_links l
       WHERE l.player_user_id=cl.auth_user_id AND l.parent_user_id=auth.uid()) END)
   AND EXISTS (SELECT 1 FROM public.parental_consents c
     WHERE (c.roster_child_id=rc.id OR c.player_user_id=cl.auth_user_id)
       AND c.withdrawn_at IS NULL AND c.superseded_by IS NULL AND c.purposes->'coaching_records'='true'::jsonb)
 ORDER BY 3,1
$$;
REVOKE ALL ON FUNCTION public.my_child_credential_targets() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_my_child_credentials()
RETURNS TABLE(roster_child_id uuid, first_name text, username text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT t.roster_child_id,t.first_name,t.username FROM public.my_child_credential_targets() t
$$;
CREATE FUNCTION public.authorize_child_password_reset(p_roster_child_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_target uuid;
BEGIN
 SELECT t.auth_user_id INTO v_target FROM public.my_child_credential_targets() t
 WHERE t.roster_child_id=p_roster_child_id;
 IF v_target IS NULL THEN RAISE EXCEPTION 'Use your linked guardian account with current approval' USING ERRCODE='42501'; END IF;
 RETURN v_target;
END $$;
REVOKE ALL ON FUNCTION public.get_my_child_credentials(),public.authorize_child_password_reset(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_child_credentials(),public.authorize_child_password_reset(uuid) TO authenticated;

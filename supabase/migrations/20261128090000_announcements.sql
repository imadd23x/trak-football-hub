-- TRAK-602 (coach–player P16, Makis's PR list of 23 Nov): a coach posts a short announcement to one of their squads,
-- with an optional https:// link, and can ask the players to answer Got it by a day. The coach can withdraw it later:
-- players stop seeing it and the coach keeps it. Squads only: no academy-wide or family announcements. P17 (TRAK-603)
-- shows it in the player's bell; my_announcements() below is what it reads.
--
--   switch on:  INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'announcements');
-- It starts off for every academy. Off, every write refuses (42501) and the reads return no rows.
--
-- Got it is a TRAK-578 squad task (source 'announcement'), due at the end of the coach's day on the academy's clock, as
-- P18's tasks are (Tarek, 27 Nov: the coach picks the day). It needs the tasks switch too, since only there do players
-- have My tasks. Withdrawing closes it.
--
-- Who reads what: no app role has a privilege on the table. The coach posts, withdraws and lists their own through the
-- functions below. A player reads their squads' live announcements through my_announcements(), with the squad rule
-- tasks use (an active roster row of that coach and age group, in the same academy), the switch and consent. Nothing
-- says who else read or answered. Parents read none yet; a parent PR adds them with a new migration.

ALTER TABLE public.academy_features
  DROP CONSTRAINT academy_features_feature_check,
  ADD CONSTRAINT academy_features_feature_check
    CHECK (feature IN ('events', 'games', 'training', 'season_plan', 'family_look', 'tasks', 'announcements'));

CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  squad text NOT NULL CHECK (squad = btrim(squad) AND squad <> ''),
  body text NOT NULL CHECK (body = btrim(body, E' \t\r\n') AND char_length(body) BETWEEN 1 AND 500),
  link text CHECK (link ~ '^https://[^[:space:]]+$' AND char_length(link) <= 2000),
  -- The last day players can answer Got it, on the academy's clock. NULL: no Got it asked.
  got_it_by date,
  published_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE INDEX announcements_squad_idx ON public.announcements (coach_user_id, squad, published_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.announcements FROM PUBLIC, anon, authenticated;

-- ── Coach: post, withdraw, list ────────────────────────────────────────────
-- A body over 500 characters, an empty one or a link that isn't https:// is refused by the table (23514).
CREATE FUNCTION public.post_announcement(p_squad text, p_body text, p_link text DEFAULT NULL, p_got_it_by date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_squad text := btrim(p_squad);
 v_body text := btrim(p_body, E' \t\r\n');
 v_org uuid := public.my_coach_organization_id();
 v_id uuid;
 v_title text;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT public.is_coach() OR v_org IS NULL OR NOT trak_private.coaches_squad(v_squad) THEN
  RAISE EXCEPTION 'This squad isn''t one of yours' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('announcements') THEN
  RAISE EXCEPTION 'Announcements are switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF p_got_it_by IS NOT NULL AND NOT public.feature_on('tasks') THEN
  RAISE EXCEPTION 'Tasks are switched off for your academy, so players can''t answer Got it' USING ERRCODE = '42501';
 END IF;
 IF p_got_it_by < trak_private.academy_today(v_org) THEN
  RAISE EXCEPTION 'Select a day from today on' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.announcements (organization_id, coach_user_id, squad, body, link, got_it_by)
 VALUES (v_org, (SELECT auth.uid()), v_squad, v_body, nullif(btrim(p_link), ''), p_got_it_by)
 RETURNING id INTO v_id;
 IF p_got_it_by IS NOT NULL THEN
  -- My tasks' title: the message on one line, cut to a task title's 80 characters.
  v_title := regexp_replace(v_body, '[[:space:]]+', ' ', 'g');
  IF char_length(v_title) > 80 THEN v_title := rtrim(left(v_title, 79)) || '…'; END IF;
  INSERT INTO public.trak_tasks (organization_id, coach_user_id, squad, source_type, source_id, answer_kind, title, due_at)
  VALUES (v_org, (SELECT auth.uid()), v_squad, 'announcement', v_id, 'got_it', v_title,
    (p_got_it_by + 1)::timestamp AT TIME ZONE trak_private.academy_time_zone(v_org));
 END IF;
 RETURN v_id;
END $$;

-- Withdrawing twice keeps the first time.
CREATE FUNCTION public.withdraw_announcement(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.feature_on('announcements') THEN
  RAISE EXCEPTION 'Announcements are switched off for your academy' USING ERRCODE = '42501';
 END IF;
 UPDATE public.announcements a SET withdrawn_at = coalesce(a.withdrawn_at, now())
 WHERE a.id = p_id AND a.coach_user_id = (SELECT auth.uid()) AND a.organization_id = public.my_coach_organization_id();
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This announcement isn''t one of yours' USING ERRCODE = '42501';
 END IF;
 UPDATE public.trak_tasks t SET status = 'closed' WHERE t.source_type = 'announcement' AND t.source_id = p_id;
END $$;

-- The coach's own, newest first, withdrawn ones too.
CREATE FUNCTION public.coach_announcements()
RETURNS TABLE (id uuid, squad text, body text, link text, got_it_by date, published_at timestamptz, withdrawn_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.squad, a.body, a.link, a.got_it_by, a.published_at, a.withdrawn_at
  FROM public.announcements a
  WHERE a.coach_user_id = (SELECT auth.uid()) AND a.organization_id = public.my_coach_organization_id()
    AND public.feature_on('announcements')
  ORDER BY a.published_at DESC, a.id;
$$;

-- ── Player: their squads' live announcements ───────────────────────────────
-- p_child is the player: NULL or the caller's own id (parents come later). time_zone is the academy's, for the date.
CREATE FUNCTION public.my_announcements(p_child uuid DEFAULT NULL)
RETURNS TABLE (id uuid, body text, link text, published_at timestamptz, time_zone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id, a.body, a.link, a.published_at, trak_private.academy_time_zone(a.organization_id)
  FROM public.announcements a
  WHERE a.withdrawn_at IS NULL
    AND (p_child IS NULL OR p_child = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.squad_players sp
      WHERE sp.linked_player_id = (SELECT auth.uid()) AND sp.status = 'active' AND sp.organization_id = a.organization_id
        AND sp.coach_user_id = a.coach_user_id AND btrim(sp.age_group) = a.squad
        AND NOT public.player_consent_required(sp.linked_player_id))
    AND EXISTS (SELECT 1 FROM public.academy_features f WHERE f.organization_id = a.organization_id AND f.feature = 'announcements')
  ORDER BY a.published_at DESC, a.id;
$$;

REVOKE ALL ON FUNCTION public.post_announcement(text, text, text, date), public.withdraw_announcement(uuid),
  public.coach_announcements(), public.my_announcements(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_announcement(text, text, text, date), public.withdraw_announcement(uuid),
  public.coach_announcements(), public.my_announcements(uuid) TO authenticated;
COMMENT ON FUNCTION public.post_announcement(text, text, text, date) IS
  'TRAK-602: a coach posts an announcement (1 to 500 characters, an optional https:// link) to their own squad; with p_got_it_by, each player is asked Got it by the end of that day on the academy''s clock. Checks the coach, the squad and both switches.';
COMMENT ON FUNCTION public.withdraw_announcement(uuid) IS
  'TRAK-602: the coach who posted it withdraws it: players stop seeing it and its Got it closes; the coach keeps it.';
COMMENT ON FUNCTION public.coach_announcements() IS
  'TRAK-602: the caller''s own announcements, newest first, withdrawn ones too.';
COMMENT ON FUNCTION public.my_announcements(uuid) IS
  'TRAK-602: the caller''s squads'' live announcements, newest first. Players only, for themselves; no rows off the roster, with consent missing or the switch off.';

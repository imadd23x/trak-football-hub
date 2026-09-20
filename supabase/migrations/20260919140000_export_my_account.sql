-- ============================================================
-- GDPR Article 20 — data portability. The twin of delete_my_account().
--
-- The July MVP spec's Gate 1 line is "Account deletion + data export —
-- Art. 17 and 20 BOTH work end to end". Erasure exists (20260526000003,
-- 20260608000006, 20260901000008) and is tested in #47. Portability did not
-- exist anywhere: no RPC, nothing in any migration, nothing in src/, and
-- nothing on any remote branch. It appeared on no task list and in neither
-- gate document, which is how it stayed invisible — the September plan's
-- real-child gate names deletion and does not name export, so nobody was
-- going to notice by reading it.
--
-- ── The boundary, which is a legal question and is NOT settled here
--
-- Article 20 covers data "provided by the data subject". Article 15 (access)
-- is broader and covers everything held about them. These are different
-- scopes and we have been saying "export" as though they were one thing.
--
--   A player's own matches and player_details          -- plainly Art. 20
--   A coach's assessments ABOUT that player            -- observations the
--                                                         coach made, not data
--                                                         the child provided.
--                                                         Art. 15, arguably
--                                                         not Art. 20.
--
-- Rather than pick, the split is declared ONCE below in
-- export_scope_includes_observations() and every section consults it. Flip
-- one boolean when counsel answers, and nothing else moves. Defaulting to
-- INCLUDING observations, because under Art. 15 the subject is entitled to
-- them and an export that silently omits a child's assessments is the worse
-- error to ship: too little is a rights failure, too much is a scope debate.
--
-- ── What this deliberately never returns
--
--   * coach_assessment_notes — coach-private by K9 (20260918135500). A
--     player's export must never carry them, and the test asserts it rather
--     than the comment claiming it.
--   * Any other user's rows. The invariant worth testing is not "did the
--     export contain their data" — a query returning everything passes that.
--     It is "did it contain ONLY theirs".
--   * Another child reachable through a shared coach. A coach's export names
--     the children they assessed, because that IS the coach's work product;
--     it does not carry those children's own match logs or parent links.
--
-- ── Why SECURITY DEFINER
--
-- Same reason delete_my_account() is: the caller must read rows across tables
-- whose policies are written for the app's read paths, not for a bulk export.
-- Scoping is therefore this function's responsibility and is done by
-- auth.uid() on every branch, never by a parameter. The function takes no
-- arguments, so there is nothing to point at someone else.
-- ============================================================

CREATE OR REPLACE FUNCTION public.export_scope_includes_observations()
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $fn$ SELECT true $fn$;

COMMENT ON FUNCTION public.export_scope_includes_observations() IS
  'Whether an export includes observations made ABOUT the subject by someone else (coach assessments, awards) rather than only data the subject provided. true = Article 15 breadth; false = Article 20 strictly. One place to change when counsel answers.';


CREATE OR REPLACE FUNCTION public.export_my_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
  v_obs   boolean := public.export_scope_includes_observations();
  v_out   jsonb;
  v_sq    uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE user_id = v_uid;

  -- Header. A subject reading this needs to know what it covers and what it
  -- does not, in the document itself — not in a support email they never got.
  v_out := jsonb_build_object(
    'exported_at',   now(),
    'account',       jsonb_build_object('user_id', v_uid, 'role', v_role),
    'scope', jsonb_build_object(
      'includes_observations_about_you', v_obs,
      'note', CASE WHEN v_obs
        THEN 'Includes assessments and awards recorded about you by a coach, as well as data you provided.'
        ELSE 'Includes only data you provided. Assessments recorded about you by a coach are available on request.'
      END,
      'never_included', 'Private coaching notes, and any record belonging to another person.'
    )
  );

  -- ── Everyone: the account itself ───────────────────────────
  v_out := v_out || jsonb_build_object(
    'profile', (
      SELECT to_jsonb(p) - 'user_id'
      FROM public.profiles p WHERE p.user_id = v_uid
    ),
    'telemetry_events', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) - 'user_id' ORDER BY t.created_at)
      FROM public.telemetry_events t WHERE t.user_id = v_uid
    ), '[]'::jsonb)
  );

  -- ── Player ─────────────────────────────────────────────────
  IF v_role = 'player' THEN
    -- Roster rows that are THIS player's link. Used to reach assessments; a
    -- coach's other children are never in this set.
    SELECT COALESCE(array_agg(sp.id), '{}') INTO v_sq
    FROM public.squad_players sp WHERE sp.linked_player_id = v_uid;

    v_out := v_out || jsonb_build_object(
      'player_details', (
        SELECT to_jsonb(d) - 'user_id' FROM public.player_details d WHERE d.user_id = v_uid
      ),
      -- Provided by the subject: they logged these.
      'matches', COALESCE((
        SELECT jsonb_agg(to_jsonb(m) - 'user_id' ORDER BY m.match_date)
        FROM public.matches m WHERE m.user_id = v_uid
      ), '[]'::jsonb),
      'parent_links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('parent_user_id', l.parent_user_id, 'created_at', l.created_at))
        FROM public.player_parent_links l WHERE l.player_user_id = v_uid
      ), '[]'::jsonb),
      'parental_consents', COALESCE((
        SELECT jsonb_agg(to_jsonb(c) ORDER BY c.granted_at)
        FROM public.parental_consents c WHERE c.player_user_id = v_uid
      ), '[]'::jsonb)
    );

    -- Observations ABOUT the player. Gated on the scope switch above.
    -- coach_assessment_notes is absent by design and stays absent whatever
    -- the switch says: K9 made it coach-private and portability does not
    -- reopen it.
    IF v_obs THEN
      v_out := v_out || jsonb_build_object(
        'coach_assessments', COALESCE((
          SELECT jsonb_agg(to_jsonb(a) - 'coach_user_id' ORDER BY a.created_at)
          FROM public.coach_assessments a WHERE a.squad_player_id = ANY(v_sq)
        ), '[]'::jsonb),
        'recognition_awards', COALESCE((
          SELECT jsonb_agg(to_jsonb(r) - 'coach_user_id' ORDER BY r.created_at)
          FROM public.recognition_awards r WHERE r.squad_player_id = ANY(v_sq)
        ), '[]'::jsonb)
      );
    END IF;
  END IF;

  -- ── Coach ──────────────────────────────────────────────────
  -- A coach's own work product. The children's own records (their match logs,
  -- their parent links) are theirs, not the coach's, and are not here.
  IF v_role = 'coach' THEN
    v_out := v_out || jsonb_build_object(
      'coach_details', (
        SELECT to_jsonb(d) - 'user_id' FROM public.coach_details d WHERE d.user_id = v_uid
      ),
      'squad_players', COALESCE((
        SELECT jsonb_agg(to_jsonb(sp) - 'coach_user_id' ORDER BY sp.created_at)
        FROM public.squad_players sp WHERE sp.coach_user_id = v_uid
      ), '[]'::jsonb),
      'coach_assessments', COALESCE((
        SELECT jsonb_agg(to_jsonb(a) - 'coach_user_id' ORDER BY a.created_at)
        FROM public.coach_assessments a WHERE a.coach_user_id = v_uid
      ), '[]'::jsonb),
      'coach_assessment_notes', COALESCE((
        SELECT jsonb_agg(to_jsonb(n) - 'coach_user_id' ORDER BY n.created_at)
        FROM public.coach_assessment_notes n WHERE n.coach_user_id = v_uid
      ), '[]'::jsonb),
      'coach_sessions', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) - 'coach_user_id' ORDER BY s.created_at)
        FROM public.coach_sessions s WHERE s.coach_user_id = v_uid
      ), '[]'::jsonb),
      'coach_calendar_events', COALESCE((
        SELECT jsonb_agg(to_jsonb(e) - 'coach_user_id' ORDER BY e.starts_at)
        FROM public.coach_calendar_events e WHERE e.coach_user_id = v_uid
      ), '[]'::jsonb),
      'recognition_awards', COALESCE((
        SELECT jsonb_agg(to_jsonb(r) - 'coach_user_id' ORDER BY r.created_at)
        FROM public.recognition_awards r WHERE r.coach_user_id = v_uid
      ), '[]'::jsonb),
      'staff_compliance', COALESCE((
        SELECT jsonb_agg(to_jsonb(sc) - 'coach_user_id')
        FROM public.staff_compliance sc WHERE sc.coach_user_id = v_uid
      ), '[]'::jsonb)
    );
  END IF;

  -- ── Parent ─────────────────────────────────────────────────
  -- The links and consents the parent themselves granted. Their child's
  -- records belong to the child and are exported from the child's account.
  IF v_role = 'parent' THEN
    v_out := v_out || jsonb_build_object(
      'child_links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('player_user_id', l.player_user_id, 'created_at', l.created_at))
        FROM public.player_parent_links l WHERE l.parent_user_id = v_uid
      ), '[]'::jsonb),
      'consents_granted', COALESCE((
        SELECT jsonb_agg(to_jsonb(c) ORDER BY c.granted_at)
        FROM public.parental_consents c WHERE c.parent_user_id = v_uid
      ), '[]'::jsonb)
    );
  END IF;

  -- ── Club admin ─────────────────────────────────────────────
  IF v_role = 'club' THEN
    v_out := v_out || jsonb_build_object(
      'organizations', COALESCE((
        SELECT jsonb_agg(to_jsonb(o) - 'admin_user_id')
        FROM public.organizations o WHERE o.admin_user_id = v_uid
      ), '[]'::jsonb),
      'admin_notes', COALESCE((
        SELECT jsonb_agg(to_jsonb(n) - 'admin_user_id' ORDER BY n.created_at)
        FROM public.admin_notes n WHERE n.admin_user_id = v_uid
      ), '[]'::jsonb)
    );
  END IF;

  RETURN v_out;
END;
$fn$;

COMMENT ON FUNCTION public.export_my_account() IS
  'GDPR Article 20 portability. Returns one JSON document of the caller''s own data, scoped by auth.uid() on every branch. Takes no arguments, so it cannot be pointed at another account. Never returns another user''s rows, and never returns coach_assessment_notes to a player.';

REVOKE ALL ON FUNCTION public.export_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_account() TO authenticated;

REVOKE ALL ON FUNCTION public.export_scope_includes_observations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_scope_includes_observations() TO authenticated;

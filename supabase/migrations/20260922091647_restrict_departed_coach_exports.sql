-- U8: account portability must not reopen revoked academy roster access.
-- Keep all historical migrations unchanged. Reuse the same current-ownership
-- predicate as ordinary assessment/award reads, including departed status and
-- pinned academy membership. Keep subject-owned profile/telemetry and unrelated
-- role branches unchanged; do not delete retained academy history.
-- This forward correction is scoped to roster-linked export records. Sessions
-- and calendar events retain their existing ordinary author-access contract.
-- Removal/transfer regressions execute the real RPC, not a mocked status flag.

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
          AND public.squad_player_is_mine(sp.id)
      ), '[]'::jsonb),
      'coach_assessments', COALESCE((
        SELECT jsonb_agg(to_jsonb(a) - 'coach_user_id' ORDER BY a.created_at)
        FROM public.coach_assessments a WHERE a.coach_user_id = v_uid
          AND public.squad_player_is_mine(a.squad_player_id)
      ), '[]'::jsonb),
      'coach_assessment_notes', COALESCE((
        SELECT jsonb_agg(to_jsonb(n) - 'coach_user_id' ORDER BY n.created_at)
        FROM public.coach_assessment_notes n WHERE n.coach_user_id = v_uid
          AND EXISTS (SELECT 1 FROM public.coach_assessments a
            WHERE a.id = n.assessment_id
              AND a.coach_user_id = v_uid
              AND public.squad_player_is_mine(a.squad_player_id))
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
          AND public.squad_player_is_mine(r.squad_player_id)
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


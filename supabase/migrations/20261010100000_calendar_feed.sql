-- TRAK-132 (J8.9): what a private calendar link shows.
--
-- A phone's calendar app fetches the feed with no login, so the calendar-feed
-- endpoint calls calendar_feed_for_token with the service role and the token
-- from the link. The feed must show exactly what the link's owner could read
-- in the app, and nothing once that access ends. So it uses J8.2's rule
-- itself, not a copy: the rule moves into family_reads_event_for(person, ...)
-- and family_reads_event(...) becomes that rule for auth.uid(). The RLS policy
-- on coach_calendar_events is unchanged.

-- J8.2's rule (20261009160000), word for word, for a given person.
CREATE FUNCTION trak_private.family_reads_event_for(p_user uuid, p_coach_user_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.squad_players sp
    WHERE sp.coach_user_id = p_coach_user_id
      AND sp.organization_id = p_organization_id
      AND sp.status <> 'coach_departed'
      AND (sp.linked_player_id = p_user
           OR EXISTS (SELECT 1 FROM public.player_parent_links ppl
                      WHERE ppl.player_user_id = sp.linked_player_id
                        AND ppl.parent_user_id = p_user))
      AND NOT public.player_consent_required(sp.linked_player_id)
  );
$fn$;
REVOKE ALL ON FUNCTION trak_private.family_reads_event_for(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION trak_private.family_reads_event_for(uuid, uuid, uuid) IS
  'J8.2''s family event rule for a given person: the RLS policy (through family_reads_event) and the calendar feed share it.';

CREATE OR REPLACE FUNCTION trak_private.family_reads_event(p_coach_user_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT trak_private.family_reads_event_for(auth.uid(), p_coach_user_id, p_organization_id);
$fn$;

-- The feed for one link. NULL: no such link (the endpoint answers 404).
-- Empty lists: the link is dead (revoked, consent withdrawn, child left the
-- squad), so the phone removes the events on its next refresh. Otherwise the
-- owner's published events from 60 days ago onwards, in the shape the
-- endpoint validates (lookupFromRpc): no title, no cancel reason, no coach
-- notes, because free text can name a child. child_names lets the endpoint
-- drop any remaining detail that mentions one (J8 check 6).
CREATE FUNCTION public.calendar_feed_for_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_link public.calendar_links;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_link FROM public.calendar_links
  WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Recorded for dead links too: something is still subscribed to them.
  UPDATE public.calendar_links SET last_fetched_at = now() WHERE id = v_link.id;

  IF v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('events', '[]'::jsonb, 'child_names', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'id', e.id::text,
          'kind', CASE WHEN e.event_type IN ('training', 'match', 'tournament', 'other') THEN e.event_type ELSE 'other' END,
          'squadLabel', coalesce((
            SELECT min(sp.age_group) FROM public.squad_players sp
            WHERE sp.coach_user_id = e.coach_user_id
              AND sp.organization_id = e.organization_id
              AND (sp.linked_player_id = v_link.user_id
                   OR EXISTS (SELECT 1 FROM public.player_parent_links ppl
                              WHERE ppl.player_user_id = sp.linked_player_id
                                AND ppl.parent_user_id = v_link.user_id))), 'Squad'),
          'date', to_char(e.day, 'YYYY-MM-DD'),
          'startTime', left(e.start_time::text, 5),
          'endTime', left(e.end_time::text, 5),
          'meetTime', left(e.meet_time::text, 5),
          'opponent', e.opponent,
          'homeAway', e.home_away,
          'venue', e.venue,
          'kit', e.kit,
          'status', e.status,
          'sequence', e.sequence,
          'updatedAt', to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ) ORDER BY e.day, e.start_time NULLS FIRST, e.id)
      FROM (
        SELECT ev.*, coalesce(ev.event_date, (ev.starts_at AT TIME ZONE 'Asia/Dubai')::date) AS day
        FROM public.coach_calendar_events ev
        WHERE ev.published
          AND trak_private.family_reads_event_for(v_link.user_id, ev.coach_user_id, ev.organization_id)
      ) e
      WHERE e.day >= current_date - 60
    ), '[]'::jsonb),
    'child_names', coalesce((
      SELECT jsonb_agg(DISTINCT sp.player_name)
      FROM public.squad_players sp
      WHERE sp.player_name IS NOT NULL
        AND (sp.linked_player_id = v_link.user_id
             OR EXISTS (SELECT 1 FROM public.player_parent_links ppl
                        WHERE ppl.player_user_id = sp.linked_player_id
                          AND ppl.parent_user_id = v_link.user_id))
    ), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.calendar_feed_for_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_feed_for_token(text) TO service_role;

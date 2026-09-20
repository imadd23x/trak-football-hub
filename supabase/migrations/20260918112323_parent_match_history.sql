-- Parent history must not derive lifetime totals from the Data API row limit.
-- Both readers retain the caller's ordinary matches RLS and additionally require
-- a parent profile and a link to this child. This does not change consent policy.

-- Cover the complete natural cursor order. Using the native date/timestamp
-- operators lets PostgreSQL retain range index conditions behind matches RLS;
-- a coalesced expression tuple remains a filter and scans the child's history.
CREATE INDEX matches_parent_history_order_idx ON public.matches (
  user_id, match_date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
);

CREATE FUNCTION public.get_parent_match_summary(p_child_id uuid)
RETURNS TABLE (
  total_count bigint,
  rated_count bigint,
  average_rating numeric,
  wins bigint,
  draws bigint,
  losses bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT totals.*
  FROM (
    SELECT link.player_user_id
    FROM public.player_parent_links AS link
    JOIN public.profiles AS parent ON parent.user_id = link.parent_user_id
    WHERE parent.user_id = auth.uid()
      AND parent.role = 'parent'
      AND link.player_user_id = p_child_id
    LIMIT 1
  ) AS authorized
  CROSS JOIN LATERAL (
    SELECT
      count(*) AS total_count,
      count(*) FILTER (WHERE m.computed_rating NOT IN
        ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) AS rated_count,
      avg(m.computed_rating) FILTER (WHERE m.computed_rating NOT IN
        ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)) AS average_rating,
      count(*) FILTER (WHERE m.team_score > m.opponent_score) AS wins,
      count(*) FILTER (WHERE m.team_score = m.opponent_score) AS draws,
      count(*) FILTER (WHERE m.team_score < m.opponent_score) AS losses
    FROM public.matches AS m
    WHERE m.user_id = authorized.player_user_id
  ) AS totals;
$function$;

CREATE FUNCTION public.get_parent_match_page(
  p_child_id uuid,
  p_after_match_date date DEFAULT NULL,
  p_after_created_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  page jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_parent_links AS link
    JOIN public.profiles AS parent ON parent.user_id = link.parent_user_id
    WHERE parent.user_id = auth.uid()
      AND parent.role = 'parent'
      AND link.player_user_id = p_child_id
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  p_limit := LEAST(101, GREATEST(1, COALESCE(p_limit, 51)));

  -- A scalar JSON array is one SQL result: PostgREST's row cap cannot truncate
  -- the bounded array and silently remove the client's lookahead row.
  -- The UUID distinguishes a first request from a cursor with NULL dates.
  IF p_after_id IS NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(result) ORDER BY result.match_date DESC NULLS LAST,
      result.created_at DESC NULLS LAST, result.id DESC), '[]'::jsonb)
    INTO page
    FROM (
      SELECT m.id, m.created_at, m.match_date, m.opponent, m.competition, m.venue,
        CASE WHEN m.computed_rating NOT IN
          ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
          THEN m.computed_rating ELSE NULL END AS computed_rating,
        m.team_score, m.opponent_score
      FROM public.matches AS m
      WHERE m.user_id = p_child_id
      ORDER BY m.match_date DESC NULLS LAST, m.created_at DESC NULLS LAST, m.id DESC
      LIMIT p_limit
    ) AS result;
  ELSE
    -- Native row comparisons seek through the index, but stop at a NULL. The
    -- remaining disjoint branches cover exactly those NULL cases, including
    -- cursors whose dates are NULL. Real +/-infinity values need no sentinel.
    -- Each branch is bounded; the final sort sees at most 7 * p_limit rows.
    -- NOT MATERIALIZED preserves the index predicates and ordinary matches RLS
    -- in each branch instead of materializing the child's complete history.
    WITH visible AS NOT MATERIALIZED (
      SELECT m.id, m.created_at, m.match_date, m.opponent, m.competition, m.venue,
        CASE WHEN m.computed_rating NOT IN
          ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
          THEN m.computed_rating ELSE NULL END AS computed_rating,
        m.team_score, m.opponent_score
      FROM public.matches AS m
      WHERE m.user_id = p_child_id
    ), candidates AS (
      (
        SELECT * FROM visible AS m
        WHERE ROW(m.match_date, m.created_at, m.id)
          < ROW(p_after_match_date, p_after_created_at, p_after_id)
        ORDER BY m.match_date DESC NULLS LAST, m.created_at DESC NULLS LAST, m.id DESC
        LIMIT p_limit
      ) UNION ALL (
        SELECT * FROM visible AS m
        WHERE p_after_match_date IS NOT NULL AND m.match_date IS NULL
        ORDER BY m.created_at DESC NULLS LAST, m.id DESC
        LIMIT p_limit
      ) UNION ALL (
        SELECT * FROM visible AS m
        WHERE m.match_date = p_after_match_date
          AND p_after_created_at IS NOT NULL AND m.created_at IS NULL
        ORDER BY m.id DESC
        LIMIT p_limit
      ) UNION ALL (
        SELECT * FROM visible AS m
        WHERE p_after_match_date IS NULL AND m.match_date IS NULL
          AND ROW(m.created_at, m.id) < ROW(p_after_created_at, p_after_id)
        ORDER BY m.created_at DESC NULLS LAST, m.id DESC
        LIMIT p_limit
      ) UNION ALL (
        SELECT * FROM visible AS m
        WHERE m.match_date = p_after_match_date
          AND p_after_created_at IS NULL AND m.created_at IS NULL AND m.id < p_after_id
        ORDER BY m.id DESC
        LIMIT p_limit
      ) UNION ALL (
        SELECT * FROM visible AS m
        WHERE p_after_match_date IS NULL AND m.match_date IS NULL AND m.created_at IS NULL
          AND p_after_created_at IS NOT NULL
        ORDER BY m.id DESC
        LIMIT p_limit
      ) UNION ALL (
        SELECT * FROM visible AS m
        WHERE p_after_match_date IS NULL AND m.match_date IS NULL AND m.created_at IS NULL
          AND p_after_created_at IS NULL AND m.id < p_after_id
        ORDER BY m.id DESC
        LIMIT p_limit
      )
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(result) ORDER BY result.match_date DESC NULLS LAST,
      result.created_at DESC NULLS LAST, result.id DESC), '[]'::jsonb)
    INTO page
    FROM (
      SELECT * FROM candidates AS m
      ORDER BY m.match_date DESC NULLS LAST, m.created_at DESC NULLS LAST, m.id DESC
      LIMIT p_limit
    ) AS result;
  END IF;
  RETURN page;
END;
$function$;

-- Legacy default privileges include explicit grants, so revoke every client
-- role first. Only authenticated callers can enter the parent/link checks.
REVOKE ALL ON FUNCTION public.get_parent_match_summary(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_parent_match_page(uuid, date, timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_parent_match_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_match_page(uuid, date, timestamptz, uuid, integer) TO authenticated;

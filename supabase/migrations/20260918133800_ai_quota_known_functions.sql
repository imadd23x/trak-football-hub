-- ============================================================
-- Follow-up to 20260918000002 (K8 / X4), from Imad's review of #41.
--
-- claim_ai_call(p_function_name text, ...) took an unconstrained text key and
-- wrote it straight into the primary key of ai_usage_daily. EXECUTE is granted
-- to `authenticated`, so any signed-in user could call the RPC directly with
-- any name they liked and insert an unbounded number of rows into a table the
-- application never reads by that key. That is storage the user controls the
-- shape of, which is not what a quota counter should be.
--
-- Constrained to the three functions that actually spend LOVABLE_API_KEY. An
-- unknown name now raises rather than silently counting, so a typo in an edge
-- function fails loudly in that function's logs instead of quietly maintaining
-- a counter nobody enforces.
--
-- Not changed, deliberately: p_daily_limit is still supplied by the caller.
-- It is worth being explicit about why, because it looks like the same class
-- of problem and is not. The limit cannot be used to gain anything — a client
-- calling the RPC directly with a huge limit only increments its own counter,
-- and every real AI call still goes through an edge function that passes its
-- own limit. The worst a direct caller achieves is spending its own allowance
-- faster. Moving the limits into this function would make them server-owned
-- and is a reasonable next step; it changes the signature and all three edge
-- functions, so it is not being smuggled into a review follow-up. Imad — say
-- if you want it and it is a small change.
--
-- Migrations are immutable, so this replaces the function rather than editing
-- 20260918000002. The timestamp is a real one: hand-numbering the previous two
-- as ...000001/...000002 put them below a migration already deployed from #35
-- and produced the out-of-order warning on this PR.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_ai_call(p_function_name text, p_daily_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_claimed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- The three functions that spend LOVABLE_API_KEY. Adding a fourth is a
  -- migration, on purpose: a quota key that nothing enforces is worse than no
  -- quota key, because it reads like coverage.
  IF p_function_name IS NULL
     OR p_function_name NOT IN ('parse-schedule', 'coach-assistant', 'player-feedback') THEN
    RAISE EXCEPTION 'Unknown AI function: %', COALESCE(p_function_name, '(null)');
  END IF;

  IF p_daily_limit IS NULL OR p_daily_limit < 1 THEN
    RAISE EXCEPTION 'A daily limit of at least 1 is required';
  END IF;

  -- The limit lives in the WHERE clause of the upsert, not in a prior read.
  -- Two simultaneous calls at the limit cannot both succeed: the second one's
  -- update matches no row and RETURNING gives nothing.
  INSERT INTO public.ai_usage_daily (user_id, function_name, usage_date, call_count)
  VALUES (v_uid, p_function_name, CURRENT_DATE, 1)
  ON CONFLICT (user_id, function_name, usage_date) DO UPDATE
    SET call_count = public.ai_usage_daily.call_count + 1
    WHERE public.ai_usage_daily.call_count < p_daily_limit
  RETURNING call_count INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_call(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_ai_call(text, integer) TO authenticated;

COMMENT ON FUNCTION public.claim_ai_call(text, integer) IS
  'Counts one AI call for the current user and returns whether it was allowed. p_function_name must be one of the three functions that spend LOVABLE_API_KEY; anything else raises. The limit is passed by the caller (an edge function) and is not a trust boundary — see 20260918133800.';

-- ============================================================
-- K8 / X4: a per-user daily cap for the AI edge functions
--
-- parse-schedule and coach-assistant both call the Lovable AI gateway with
-- LOVABLE_API_KEY, and until the companion change to those functions neither
-- required a signed-in user at all — anyone on the internet could spend the
-- key. Authentication is the fix for that; this table is the fix for the
-- second half, which is that an authenticated coach can still run the bill up
-- without limit, by accident or otherwise.
--
-- Deliberately minimal. One row per user, per function, per day, holding a
-- count. No history, no retention question, nothing that needs a GDPR answer
-- beyond the cascade on the user.
--
-- The claim is done in a SECURITY DEFINER function rather than by the caller
-- writing the row, so a client cannot set its own counter back to zero. The
-- table itself grants nothing to application roles; RLS is enabled with a
-- read-only policy for a user's own rows so a coach can be shown "you have N
-- left today" without being able to change it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name text    NOT NULL,
  usage_date    date    NOT NULL DEFAULT CURRENT_DATE,
  call_count    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, function_name, usage_date)
);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;

-- A user may see their own usage and nothing else. No INSERT, UPDATE or
-- DELETE policy exists for any application role, so the only way a row
-- changes is through claim_ai_call() below.
DROP POLICY IF EXISTS "Users read own AI usage" ON public.ai_usage_daily;
CREATE POLICY "Users read own AI usage"
  ON public.ai_usage_daily FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.ai_usage_daily FROM anon, authenticated;
GRANT SELECT ON TABLE public.ai_usage_daily TO authenticated;


-- Claim one call for the current user. Returns true when the call is allowed
-- and has been counted, false when today's allowance is already spent.
--
-- The INSERT ... ON CONFLICT DO UPDATE with the limit in its WHERE clause is
-- what makes this safe under concurrency: two simultaneous calls at the limit
-- cannot both succeed, because the second one's update matches no row and
-- RETURNING gives nothing. A read-then-write would let both through.
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

  IF p_daily_limit IS NULL OR p_daily_limit < 1 THEN
    RAISE EXCEPTION 'A daily limit of at least 1 is required';
  END IF;

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
  'Counts one AI call for the current user and returns whether it was allowed. The limit is passed by the caller (an edge function), not stored, so it can be tuned per function without a migration.';

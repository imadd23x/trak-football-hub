-- TRAK-447 (11 Nov walk-through): a goal in the match evaluation can be an own goal. It credits nobody: no scorer and
-- no assist, so the score still adds up, and the coach's form can tell it from a goal whose scorer was not recorded.
-- A goal is {scorer, assist} as before, with an optional boolean `own`; own = true needs both to be null.
-- Existing drafts and published reviews keep their shape and stay valid.
CREATE OR REPLACE FUNCTION trak_private.valid_evaluation_goals(value jsonb, our_score smallint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE goal jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(value) > COALESCE(our_score, 0) THEN RETURN false; END IF;
 FOR goal IN SELECT * FROM jsonb_array_elements(value) LOOP
  IF jsonb_typeof(goal) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(goal) k WHERE k NOT IN ('scorer', 'assist', 'own')) THEN RETURN false; END IF;
  IF COALESCE(jsonb_typeof(goal->'scorer'), 'null') NOT IN ('string', 'null')
    OR COALESCE(jsonb_typeof(goal->'assist'), 'null') NOT IN ('string', 'null') THEN RETURN false; END IF;
  IF goal->>'assist' = goal->>'scorer' THEN RETURN false; END IF;
  IF goal ? 'own' THEN
   IF jsonb_typeof(goal->'own') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
   IF (goal->>'own')::boolean AND (goal->>'scorer' IS NOT NULL OR goal->>'assist' IS NOT NULL) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END $$;

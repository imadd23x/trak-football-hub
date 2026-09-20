-- @trak-fixture
RESET ROLE;
DO $$ DECLARE failures text; BEGIN
  SELECT string_agg(label,E'\n' ORDER BY label) INTO failures FROM staff_results WHERE NOT passed;
  IF failures IS NOT NULL THEN RAISE EXCEPTION 'Staff admission assertions failed' USING DETAIL=failures; END IF;
END $$;
SELECT count(*) AS staff_assertions FROM staff_results;
ROLLBACK;

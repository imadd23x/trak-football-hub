-- @trak-suite mode=--parent-history-review in-all=true
-- Synthetic adult fixtures only. All fixture rows, temporary RLS probes and
-- the explicitly marked nullable-rating compatibility probe roll back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing parent-history fixtures outside a disposable database';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.parent_history_id(n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE parent_history_checks (description text NOT NULL);
GRANT INSERT ON parent_history_checks TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.parent_history_check(ok boolean, description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Parent match history assertion failed: %', description;
  END IF;
  INSERT INTO pg_temp.parent_history_checks VALUES (description);
END;
$test$;
CREATE FUNCTION pg_temp.parent_history_denied(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.parent_history_check(true, description);
    RETURN;
  END;
  RAISE EXCEPTION 'Expected permission denial: %', description;
END;
$test$;

-- These assertions fail before fixture setup if the migration was not applied.
SELECT pg_temp.parent_history_check(
  (SELECT count(*) = 2 AND bool_and(NOT prosecdef AND provolatile = 's'
     AND proconfig @> ARRAY['search_path=pg_catalog'])
   FROM pg_proc WHERE oid IN (
     to_regprocedure('public.get_parent_match_summary(uuid)'),
     to_regprocedure('public.get_parent_match_page(uuid,date,timestamptz,uuid,integer)'))),
  'both RPCs are STABLE SECURITY INVOKER with catalog-only search paths');
SELECT pg_temp.parent_history_check(
  (SELECT bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', oid, 'EXECUTE'))
   FROM pg_proc WHERE oid IN (
     'public.get_parent_match_summary(uuid)'::regprocedure,
     'public.get_parent_match_page(uuid,date,timestamptz,uuid,integer)'::regprocedure)),
  'only authenticated clients have EXECUTE; anon and service role do not');
SELECT pg_temp.parent_history_check(NOT EXISTS (
  SELECT 1 FROM pg_proc AS p CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
  WHERE p.oid IN ('public.get_parent_match_summary(uuid)'::regprocedure,
    'public.get_parent_match_page(uuid,date,timestamptz,uuid,integer)'::regprocedure)
    AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'),
  'PUBLIC has no EXECUTE grant on either RPC');

-- The HTTP payload remains an array, but SQL returns one scalar JSONB value.
-- Expand only in this test adapter so all role/pagination assertions exercise
-- the real RPC while retaining typed SQL comparisons and WITH ORDINALITY.
SELECT pg_temp.parent_history_check(
  (SELECT prorettype = 'jsonb'::regtype AND NOT proretset FROM pg_proc
   WHERE oid = 'public.get_parent_match_page(uuid,date,timestamptz,uuid,integer)'::regprocedure),
  'page is scalar JSONB, preventing an API row cap from truncating its array');
CREATE FUNCTION pg_temp.parent_history_page(
  p_child_id uuid, p_after_match_date date DEFAULT NULL,
  p_after_created_at timestamptz DEFAULT NULL, p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
) RETURNS TABLE (
  id uuid, created_at timestamptz, match_date date, opponent text, competition text,
  venue text, computed_rating numeric, team_score integer, opponent_score integer
) LANGUAGE sql SECURITY INVOKER AS $test$
  SELECT * FROM jsonb_to_recordset(public.get_parent_match_page(
    p_child_id, p_after_match_date, p_after_created_at, p_after_id, p_limit))
    AS page(id uuid, created_at timestamptz, match_date date, opponent text, competition text,
      venue text, computed_rating numeric, team_score integer, opponent_score integer);
$test$;

-- 1 linked parent A; 2 adult A; 3 linked adult with no matches; 4 parent B;
-- 5 adult B; 6 unrelated parent; 7 coach; 8 club admin; 9 profileless identity.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.parent_history_id(n), 'synthetic-history-' || n || '@test.invalid', now()
FROM generate_series(1, 9) AS n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.parent_history_id(1), 'parent', 'Synthetic History Parent A'),
  (pg_temp.parent_history_id(2), 'player', 'Synthetic History Adult A'),
  (pg_temp.parent_history_id(3), 'player', 'Synthetic History Empty Adult'),
  (pg_temp.parent_history_id(4), 'parent', 'Synthetic History Parent B'),
  (pg_temp.parent_history_id(5), 'player', 'Synthetic History Adult B'),
  (pg_temp.parent_history_id(6), 'parent', 'Synthetic History Unlinked Parent'),
  (pg_temp.parent_history_id(7), 'coach', 'Synthetic History Coach'),
  (pg_temp.parent_history_id(8), 'club', 'Synthetic History Admin');
INSERT INTO public.player_details (user_id, date_of_birth)
SELECT pg_temp.parent_history_id(n), '1980-01-01'::date FROM unnest(ARRAY[2, 3, 5]) AS n;
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES
  (pg_temp.parent_history_id(2), pg_temp.parent_history_id(1)),
  (pg_temp.parent_history_id(3), pg_temp.parent_history_id(1)),
  (pg_temp.parent_history_id(5), pg_temp.parent_history_id(4)),
  -- Trusted legacy relationship fixtures prove a link alone does not establish
  -- a parent profile. No client may create these links through the current API.
  (pg_temp.parent_history_id(2), pg_temp.parent_history_id(7)),
  (pg_temp.parent_history_id(2), pg_temp.parent_history_id(8)),
  (pg_temp.parent_history_id(2), pg_temp.parent_history_id(9));

-- 1,200 matches exceed the usual Data API limit. Every fourth rating is NaN;
-- valid ratings repeat 8,4,0 so zero contributes to the average of exactly 4.
-- Dates and timestamps intentionally repeat; UUID is a necessary tiebreaker.
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group,
  opponent, computed_rating, team_score, opponent_score, match_date, created_at)
SELECT pg_temp.parent_history_id(10000 + n), pg_temp.parent_history_id(2),
  'Midfielder', 'Friendly', 'Home', 'Senior', 'Synthetic opponent ' || n,
  CASE n % 4 WHEN 0 THEN 0 WHEN 1 THEN 8 WHEN 2 THEN 4 ELSE 'NaN'::numeric END,
  CASE n % 3 WHEN 0 THEN 3 WHEN 1 THEN 2 ELSE 0 END,
  CASE n % 3 WHEN 1 THEN 2 ELSE 1 END,
  '2026-01-01'::date + ((n - 1) / 30),
  '2026-02-01 12:00:00+00'::timestamptz + (((n - 1) % 30) / 3) * interval '1 hour'
FROM generate_series(1, 1200) AS n;
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group,
  opponent, computed_rating, team_score, opponent_score, match_date, created_at)
SELECT pg_temp.parent_history_id(20000 + n), pg_temp.parent_history_id(2),
  'Midfielder', 'Friendly', 'Home', 'Senior', 'Synthetic boundary ' || n,
  CASE n % 3 WHEN 0 THEN 4 WHEN 1 THEN 0 ELSE 8 END,
  CASE n % 3 WHEN 1 THEN 3 WHEN 2 THEN 2 ELSE 0 END,
  CASE n % 3 WHEN 2 THEN 2 ELSE 1 END,
  CASE WHEN n <= 3 THEN 'infinity'::date WHEN n <= 5 THEN '-infinity'::date
    ELSE '2026-02-01'::date END,
  CASE n WHEN 1 THEN 'infinity'::timestamptz WHEN 2 THEN '-infinity'::timestamptz
    WHEN 4 THEN 'infinity'::timestamptz WHEN 5 THEN '-infinity'::timestamptz
    WHEN 6 THEN 'infinity'::timestamptz WHEN 7 THEN '-infinity'::timestamptz
    ELSE NULL END
FROM generate_series(1, 9) AS n;
-- INSERT stamps a missing match_date today; existing rows can genuinely carry
-- NULL, so set those legacy values through the ordinary UPDATE shape afterward.
UPDATE public.matches SET match_date = NULL
WHERE id IN (pg_temp.parent_history_id(20006), pg_temp.parent_history_id(20007), pg_temp.parent_history_id(20008));
UPDATE public.matches SET computed_rating = 'NaN'
WHERE id IN (pg_temp.parent_history_id(20002), pg_temp.parent_history_id(20005), pg_temp.parent_history_id(20009));
-- Keep the six finite boundary ratings balanced at an average of four.
UPDATE public.matches SET computed_rating = CASE id
  WHEN pg_temp.parent_history_id(20001) THEN 0 WHEN pg_temp.parent_history_id(20003) THEN 8
  WHEN pg_temp.parent_history_id(20004) THEN 4 WHEN pg_temp.parent_history_id(20006) THEN 0
  WHEN pg_temp.parent_history_id(20007) THEN 8 ELSE 4 END
WHERE id IN (pg_temp.parent_history_id(20001), pg_temp.parent_history_id(20003),
  pg_temp.parent_history_id(20004), pg_temp.parent_history_id(20006),
  pg_temp.parent_history_id(20007), pg_temp.parent_history_id(20008));
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group,
  opponent, computed_rating, team_score, opponent_score)
VALUES (pg_temp.parent_history_id(30001), pg_temp.parent_history_id(5), 'Goalkeeper',
  'Friendly', 'Away', 'Senior', 'Synthetic foreign opponent', 9, 5, 0);

-- The independent oracle sorts all rows directly; it does not repeat the
-- implementation's cursor-range branches.
CREATE TEMP TABLE parent_history_expected AS
SELECT row_number() OVER (ORDER BY match_date DESC NULLS LAST,
    created_at DESC NULLS LAST, id DESC) AS ordinal, id, match_date, created_at
FROM public.matches WHERE user_id = pg_temp.parent_history_id(2);
CREATE TEMP TABLE parent_history_seen (
  ordinal bigint PRIMARY KEY, id uuid UNIQUE, match_date date, created_at timestamptz
);
GRANT SELECT ON parent_history_expected TO authenticated;
GRANT SELECT, INSERT ON parent_history_seen TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.parent_history_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.parent_history_check((SELECT total_count = 1209 AND rated_count = 906
  AND average_rating = 4 AND wins = 403 AND draws = 403 AND losses = 403
  FROM public.get_parent_match_summary(pg_temp.parent_history_id(2))),
  'summary covers all 1209 rows, excludes NaN, preserves zero, and counts every outcome');
SELECT pg_temp.parent_history_check((SELECT count(*) = 1 AND bool_and(total_count = 0
  AND rated_count = 0 AND average_rating IS NULL AND wins = 0 AND draws = 0 AND losses = 0)
  FROM public.get_parent_match_summary(pg_temp.parent_history_id(3))),
  'authorized empty child receives one zero-count row with NULL average');
SELECT pg_temp.parent_history_check((SELECT count(*) = 0
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(3))), 'authorized empty child has no match page');
SELECT pg_temp.parent_history_check(
  jsonb_array_length(public.get_parent_match_page(pg_temp.parent_history_id(2))) = 51,
  'scalar JSON array itself contains all 51 default rows');
SELECT pg_temp.parent_history_check(
  jsonb_array_length(public.get_parent_match_page(pg_temp.parent_history_id(2), p_limit => 2147483647)) = 101,
  'scalar JSON array itself cannot exceed the 101-row ceiling');
SELECT pg_temp.parent_history_check(
  public.get_parent_match_page(pg_temp.parent_history_id(3)) = '[]'::jsonb,
  'empty scalar payload is an array, not SQL NULL or an object');
SELECT pg_temp.parent_history_check((SELECT count(*) = 51
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2))), 'default page size is 51');
SELECT pg_temp.parent_history_check((SELECT count(*) = 101
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), p_limit => 2147483647)), 'large page limit is capped at 101');
SELECT pg_temp.parent_history_check((SELECT count(*) = 1
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), p_limit => 0)), 'zero page limit is clamped to one');
SELECT pg_temp.parent_history_check((SELECT count(*) = 1
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), p_limit => -2147483648)), 'negative page limit is clamped to one');
SELECT pg_temp.parent_history_check((SELECT count(*) = 51
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), p_limit => NULL)), 'NULL page limit uses default 51');
SELECT pg_temp.parent_history_check((SELECT computed_rating = 0
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), p_limit => 1)), 'page preserves a genuine zero rating');
SELECT pg_temp.parent_history_check((SELECT computed_rating IS NULL
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), 'infinity', 'infinity', pg_temp.parent_history_id(20001), 1)),
  'page normalizes nonfinite rating to NULL instead of returning a JSON NaN string');
SELECT pg_temp.parent_history_check((SELECT array_agg(key ORDER BY key) = ARRAY[
  'competition','computed_rating','created_at','id','match_date','opponent','opponent_score','team_score','venue']
  FROM jsonb_object_keys(public.get_parent_match_page(pg_temp.parent_history_id(2), p_limit => 1)->0) AS key),
  'raw JSON payload exposes only the nine approved ParentMatch fields');
SELECT pg_temp.parent_history_check((SELECT id = pg_temp.parent_history_id(10002)
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), '2026-01-01', '2026-02-01 12:00:00+00', pg_temp.parent_history_id(10003), 1)),
  'UUID cursor orders rows whose match date and created timestamp tie');

INSERT INTO parent_history_seen
SELECT page.ordinality, page.id, page.match_date, page.created_at
FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2)) WITH ORDINALITY AS page;
RESET ROLE;
-- A newer match arrives between requests. It must not shift the remaining
-- cursor walk or duplicate the old first page. It will appear on refresh.
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group,
  opponent, computed_rating, team_score, opponent_score, match_date, created_at)
VALUES (pg_temp.parent_history_id(90000), pg_temp.parent_history_id(2), 'Midfielder',
  'Friendly', 'Home', 'Senior', 'Synthetic newly inserted opponent', 10, 2, 0, 'infinity', 'infinity');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE cursor_row record; inserted integer; page_number integer := 1;
BEGIN
  LOOP
    SELECT * INTO cursor_row FROM parent_history_seen ORDER BY ordinal DESC LIMIT 1;
    INSERT INTO parent_history_seen
    SELECT cursor_row.ordinal + page.ordinality, page.id, page.match_date, page.created_at
    FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), cursor_row.match_date,
      cursor_row.created_at, cursor_row.id, 37) WITH ORDINALITY AS page;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    PERFORM pg_temp.parent_history_check(inserted <= 37, 'cursor page ' || page_number || ' is bounded');
    EXIT WHEN inserted = 0;
    page_number := page_number + 1;
    IF page_number > 40 THEN RAISE EXCEPTION 'Cursor failed to terminate'; END IF;
  END LOOP;
END;
$test$;
SELECT pg_temp.parent_history_check((SELECT count(*) = 1209 FROM parent_history_seen)
  AND NOT EXISTS (SELECT 1 FROM parent_history_expected AS expected
    FULL JOIN parent_history_seen AS seen USING (ordinal)
    WHERE expected.id IS DISTINCT FROM seen.id),
  'all 1209 original rows appear once in exact order despite an intervening newer insert');
SELECT pg_temp.parent_history_check((SELECT id = pg_temp.parent_history_id(90000)
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), p_limit => 1)), 'refresh sees the newly inserted newest row');
SELECT pg_temp.parent_history_check((SELECT total_count = 1210 AND rated_count = 907
  AND average_rating = 3634::numeric / 907 AND wins = 404 AND draws = 403 AND losses = 403
  FROM public.get_parent_match_summary(pg_temp.parent_history_id(2))), 'summary independently sees the new row');

-- Exercise a cursor at every special boundary, even if a normal page happens
-- to contain the whole boundary group. Includes real +/-infinity and both NULLs.
DO $test$
DECLARE boundary record; expected uuid[]; actual uuid[];
BEGIN
  FOR boundary IN SELECT * FROM parent_history_expected WHERE id >= pg_temp.parent_history_id(20001) LOOP
    SELECT array_agg(id ORDER BY ordinal) INTO expected
    FROM (SELECT id, ordinal FROM parent_history_expected
      WHERE ordinal > boundary.ordinal ORDER BY ordinal LIMIT 101) AS rest;
    SELECT array_agg(id ORDER BY ordinality) INTO actual
    FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), boundary.match_date,
      boundary.created_at, boundary.id, 101) WITH ORDINALITY;
    PERFORM pg_temp.parent_history_check(actual IS NOT DISTINCT FROM expected,
      'nullable/infinity cursor boundary ' || boundary.id);
  END LOOP;
END;
$test$;

-- Foreign identity and ordinary role checks use real authenticated calls.
SELECT pg_temp.parent_history_check((SELECT count(*) = 0 FROM public.get_parent_match_summary(pg_temp.parent_history_id(5)))
  AND (SELECT count(*) = 0 FROM pg_temp.parent_history_page(pg_temp.parent_history_id(5))), 'parent A cannot read foreign child B');
SELECT pg_temp.parent_history_check((SELECT count(*) = 0 FROM public.get_parent_match_summary(NULL))
  AND (SELECT count(*) = 0 FROM pg_temp.parent_history_page(NULL)), 'NULL child cannot authorize a read');
DO $test$
DECLARE identity integer;
BEGIN
  FOREACH identity IN ARRAY ARRAY[2, 4, 6, 7, 8, 9] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.parent_history_id(identity), 'role', 'authenticated')::text, true);
    PERFORM pg_temp.parent_history_check((SELECT count(*) = 0 FROM public.get_parent_match_summary(pg_temp.parent_history_id(2)))
      AND (SELECT count(*) = 0 FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2))),
      'no parent authorization for player/foreign/unlinked/coach/admin/profileless identity ' || identity);
  END LOOP;
END;
$test$;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.parent_history_id(4), 'role', 'authenticated')::text, true);
SELECT pg_temp.parent_history_check((SELECT total_count = 1 AND average_rating = 9
  FROM public.get_parent_match_summary(pg_temp.parent_history_id(5))), 'parent B can still read their own child');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.parent_history_id(1), 'role', 'authenticated')::text, true);

RESET ROLE;
-- Fixture-only restrictive policy proves the RPC cannot bypass ordinary RLS.
CREATE POLICY parent_history_fixture_deny ON public.matches AS RESTRICTIVE
  FOR SELECT TO authenticated USING (false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.parent_history_check((SELECT count(*) = 1 AND bool_and(total_count = 0 AND rated_count = 0 AND average_rating IS NULL)
  FROM public.get_parent_match_summary(pg_temp.parent_history_id(2)))
  AND (SELECT count(*) = 0 FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2))), 'both invoker readers honor a restrictive matches RLS policy');
RESET ROLE;
DROP POLICY parent_history_fixture_deny ON public.matches;

-- Compatibility-only probe: today's numeric(3,1) column is NOT NULL and cannot
-- store numeric infinities. NaN above is valid real-schema data. Temporarily
-- relax only NOT NULL to cover an imported/legacy NULL rating; restore it here
-- and roll back the entire fixture transaction. No application schema change.
ALTER TABLE public.matches ALTER COLUMN computed_rating DROP NOT NULL;
UPDATE public.matches SET computed_rating = NULL WHERE id = pg_temp.parent_history_id(10001);
SET LOCAL ROLE authenticated;
SELECT pg_temp.parent_history_check((SELECT total_count = 1210 AND rated_count = 906
  AND average_rating = 3626::numeric / 906 FROM public.get_parent_match_summary(pg_temp.parent_history_id(2))), 'NULL-rating compatibility excludes the absent rating from the denominator');
SELECT pg_temp.parent_history_check((SELECT id = pg_temp.parent_history_id(10001) AND computed_rating IS NULL
  FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2), '2026-01-01', '2026-02-01 12:00:00+00', pg_temp.parent_history_id(10002), 1)), 'NULL-rating compatibility preserves the match row');
RESET ROLE;
UPDATE public.matches SET computed_rating = 8 WHERE id = pg_temp.parent_history_id(10001);
ALTER TABLE public.matches ALTER COLUMN computed_rating SET NOT NULL;

DELETE FROM public.player_parent_links
WHERE player_user_id = pg_temp.parent_history_id(2) AND parent_user_id = pg_temp.parent_history_id(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.parent_history_check((SELECT count(*) = 0 FROM public.get_parent_match_summary(pg_temp.parent_history_id(2)))
  AND (SELECT count(*) = 0 FROM pg_temp.parent_history_page(pg_temp.parent_history_id(2))), 'unlinking immediately removes access to summary and pages');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.parent_history_denied('SELECT * FROM public.get_parent_match_summary(pg_temp.parent_history_id(2))', 'anon cannot execute summary');
SELECT pg_temp.parent_history_denied('SELECT * FROM public.get_parent_match_page(pg_temp.parent_history_id(2))', 'anon cannot execute page');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.parent_history_denied('SELECT * FROM public.get_parent_match_summary(pg_temp.parent_history_id(2))', 'service role cannot execute summary');
SELECT pg_temp.parent_history_denied('SELECT * FROM public.get_parent_match_page(pg_temp.parent_history_id(2))', 'service role cannot execute page');
RESET ROLE;
SELECT count(*) AS parent_match_history_assertions FROM parent_history_checks;
ROLLBACK;

-- Roster identity safety, not fuzzy-name reconciliation or concurrent signup.
-- Run only through scripts/audits/roster-adoption.mjs: it validates every result,
-- rolls back fixtures, and fails for any unexpected SQL/fixture/control error.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing roster fixtures outside the disposable harness';
  END IF;
END;
$test$;
CREATE FUNCTION pg_temp.rid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('95000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE roster_results (id text PRIMARY KEY, kind text NOT NULL, status text NOT NULL, detail text NOT NULL);
GRANT SELECT, INSERT ON pg_temp.roster_results TO authenticated;
CREATE FUNCTION pg_temp.rassert(id text, kind text, ok boolean, detail text)
RETURNS void LANGUAGE sql AS $test$
  INSERT INTO pg_temp.roster_results VALUES (id, kind, CASE WHEN ok IS TRUE THEN 'pass' ELSE 'fail' END, detail);
$test$;

-- Trusted fixture creation with no actor. Every player is a synthetic adult.
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.rid(n), 'roster-' || n || '@synthetic.test.invalid', now()
FROM unnest(ARRAY[2,10,11,20,21,22]) n;
INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.rid(2), 'club', 'Synthetic Academy Admin', NULL),
  (pg_temp.rid(10), 'coach', 'Synthetic Adoption Coach', 'RAUDIT'),
  (pg_temp.rid(11), 'coach', 'Synthetic Control Coach', 'RCTRL'),
  (pg_temp.rid(20), 'player', 'Synthetic Yusuf Exact', NULL),
  (pg_temp.rid(21), 'player', 'Synthetic Mohammed Typo', NULL),
  (pg_temp.rid(22), 'player', 'Synthetic Ali Namesake', NULL);
INSERT INTO public.player_details (user_id, date_of_birth)
SELECT pg_temp.rid(n), DATE '2000-01-01' FROM unnest(ARRAY[20,21,22]) n;
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.rid(1), pg_temp.rid(2), 'Synthetic Roster Academy', 'RAORG');
INSERT INTO public.coach_details (user_id, organization_id)
SELECT pg_temp.rid(n), pg_temp.rid(1) FROM unnest(ARRAY[10,11]) n;
INSERT INTO public.squad_players
  (id, coach_user_id, player_name, organization_id, status, shirt_number, age, linked_player_id)
VALUES
  (pg_temp.rid(30), pg_temp.rid(10), 'Synthetic Yusuf Exact', pg_temp.rid(1), 'active', 30, 26, NULL),
  (pg_temp.rid(31), pg_temp.rid(10), 'Synthetic Mohammad Typo', pg_temp.rid(1), 'active', 31, 26, NULL),
  (pg_temp.rid(32), pg_temp.rid(10), 'Synthetic Ali Namesake', pg_temp.rid(1), 'active', 32, 25, NULL),
  (pg_temp.rid(33), pg_temp.rid(10), 'Synthetic Ali Namesake', pg_temp.rid(1), 'active', 33, 27, NULL),
  -- A different coach avoids the target RPC's already-linked early return.
  (pg_temp.rid(50), pg_temp.rid(11), 'Synthetic Control Exact', pg_temp.rid(1), 'active', 50, 26, pg_temp.rid(20)),
  (pg_temp.rid(51), pg_temp.rid(11), 'Synthetic Control Typo', pg_temp.rid(1), 'active', 51, 26, pg_temp.rid(21)),
  (pg_temp.rid(52), pg_temp.rid(11), 'Synthetic Control Ambiguous', pg_temp.rid(1), 'active', 52, 26, pg_temp.rid(22));
INSERT INTO public.coach_assessments
  (id, coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability, organization_id)
SELECT pg_temp.rid(n), pg_temp.rid(coach), pg_temp.rid(sp), score, score, score, score, score, score, pg_temp.rid(1)
FROM (VALUES (40,10,30,7), (41,10,30,8), (42,10,31,5), (43,10,31,6),
             (44,10,32,3), (45,10,32,4), (46,10,33,9), (47,10,33,10),
             (60,11,50,6), (61,11,51,7), (62,11,52,8)) t(n,coach,sp,score);
CREATE TEMP TABLE original_roster AS
SELECT id, to_jsonb(sp) AS body FROM public.squad_players sp WHERE id IN
  (pg_temp.rid(30), pg_temp.rid(31), pg_temp.rid(32), pg_temp.rid(33));
CREATE TEMP TABLE original_history AS
SELECT id, to_jsonb(ca) AS body FROM public.coach_assessments ca WHERE squad_player_id IN
  (pg_temp.rid(30), pg_temp.rid(31), pg_temp.rid(32), pg_temp.rid(33));
SELECT pg_temp.rassert('RA-C-fixture', 'control',
  (SELECT count(*) = 4 FROM original_roster) AND (SELECT count(*) = 8 FROM original_history)
  AND (SELECT count(*) = 11 FROM public.coach_assessments WHERE id::text LIKE '95000000-%'),
  'Four distinct target identities, two assessments each, three independent same-actor read controls');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub',pg_temp.rid(20),'role','authenticated')::text, true);
SELECT pg_temp.rassert('RA-C-exact-role', 'control', current_user = 'authenticated' AND auth.uid() = pg_temp.rid(20), 'Actual authenticated SQL role and exact-match player JWT');
SELECT pg_temp.rassert('RA-C-exact-read', 'control',
  (SELECT array_agg(id ORDER BY id) = ARRAY[pg_temp.rid(60)] FROM public.coach_assessments WHERE squad_player_id = pg_temp.rid(50)),
  'Same actor can SELECT their independently linked assessment');
DO $test$
DECLARE first_id uuid; second_id uuid;
BEGIN
  first_id := public.link_player_to_coach('RAUDIT');
  PERFORM pg_temp.rassert('RA-exact-id', 'check', first_id = pg_temp.rid(30), 'Unique exact name adopts original roster ID');
  PERFORM pg_temp.rassert('RA-exact-owner', 'check', EXISTS (
    SELECT 1 FROM public.squad_players WHERE id = pg_temp.rid(30) AND linked_player_id = auth.uid()), 'Original row linked to the authenticated caller');
  PERFORM pg_temp.rassert('RA-exact-read', 'check',
    (SELECT array_agg(id ORDER BY id) = ARRAY[pg_temp.rid(40),pg_temp.rid(41)] FROM public.coach_assessments WHERE squad_player_id = first_id),
    'Authenticated caller reads both original assessment IDs');
  second_id := public.link_player_to_coach('RAUDIT');
  PERFORM pg_temp.rassert('RA-exact-repeat', 'check', second_id = first_id AND first_id = pg_temp.rid(30), 'Sequential repeat returns the same original ID');
END;
$test$;

SELECT set_config('request.jwt.claims', json_build_object('sub',pg_temp.rid(21),'role','authenticated')::text, true);
SELECT pg_temp.rassert('RA-C-typo-role', 'control', current_user = 'authenticated' AND auth.uid() = pg_temp.rid(21), 'Actual authenticated SQL role and typo player JWT');
SELECT pg_temp.rassert('RA-C-typo-read', 'control',
  (SELECT array_agg(id ORDER BY id) = ARRAY[pg_temp.rid(61)] FROM public.coach_assessments WHERE squad_player_id = pg_temp.rid(51)),
  'Same actor can SELECT their independently linked assessment');
DO $test$
DECLARE linked_id uuid;
BEGIN
  linked_id := public.link_player_to_coach('RAUDIT');
  PERFORM pg_temp.rassert('RA-typo-own-link', 'check', linked_id IS NOT NULL AND linked_id <> pg_temp.rid(31) AND EXISTS (
    SELECT 1 FROM public.squad_players WHERE id = linked_id AND linked_player_id = auth.uid()
      AND coach_user_id = pg_temp.rid(10) AND organization_id = pg_temp.rid(1)), 'Nonmatching spelling links to the requested coach and academy without guessing the old identity');
  PERFORM pg_temp.rassert('RA-typo-no-wrong-read', 'check',
    NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE id IN (pg_temp.rid(42),pg_temp.rid(43))),
    'Authenticated caller cannot read the unverified typo identity history');
END;
$test$;

SELECT set_config('request.jwt.claims', json_build_object('sub',pg_temp.rid(22),'role','authenticated')::text, true);
SELECT pg_temp.rassert('RA-C-ambiguous-role', 'control', current_user = 'authenticated' AND auth.uid() = pg_temp.rid(22), 'Actual authenticated SQL role and namesake player JWT');
SELECT pg_temp.rassert('RA-C-ambiguous-read', 'control',
  (SELECT array_agg(id ORDER BY id) = ARRAY[pg_temp.rid(62)] FROM public.coach_assessments WHERE squad_player_id = pg_temp.rid(52)),
  'Same actor can SELECT their independently linked assessment');
DO $test$
DECLARE linked_id uuid;
BEGIN
  linked_id := public.link_player_to_coach('RAUDIT');
  PERFORM pg_temp.rassert('RA-ambiguous-own-link', 'check', linked_id IS NOT NULL AND linked_id NOT IN (pg_temp.rid(32),pg_temp.rid(33)) AND EXISTS (
    SELECT 1 FROM public.squad_players WHERE id = linked_id AND linked_player_id = auth.uid()
      AND coach_user_id = pg_temp.rid(10) AND organization_id = pg_temp.rid(1)), 'Ambiguity links to the requested coach and academy without choosing either preexisting namesake');
  PERFORM pg_temp.rassert('RA-ambiguous-no-wrong-read', 'check',
    NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE id IN (pg_temp.rid(44),pg_temp.rid(45),pg_temp.rid(46),pg_temp.rid(47))),
    'Authenticated caller cannot read either unverified namesake history');
END;
$test$;

-- Owner checks establish preservation independently of player RLS hiding data.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT pg_temp.rassert('RA-exact-one-link', 'check',
  (SELECT count(*) = 1 AND bool_and(id = pg_temp.rid(30) AND linked_player_id = pg_temp.rid(20))
   FROM public.squad_players WHERE coach_user_id = pg_temp.rid(10) AND player_name = 'Synthetic Yusuf Exact'),
  'Owner verifies sequential repeat leaves only the original row, including rows hidden by player RLS');
SELECT pg_temp.rassert('RA-typo-identity', 'check',
  (SELECT to_jsonb(sp) = original.body FROM original_roster original LEFT JOIN public.squad_players sp USING(id) WHERE original.id = pg_temp.rid(31)),
  'Typo row retains its full original identity and remains unlinked');
SELECT pg_temp.rassert('RA-ambiguous-identities', 'check',
  (SELECT count(*) = 2 AND bool_and(to_jsonb(sp) IS NOT DISTINCT FROM original.body) FROM original_roster original
   LEFT JOIN public.squad_players sp USING(id) WHERE original.id IN (pg_temp.rid(32),pg_temp.rid(33))),
  'Both namesake rows retain all identity fields; deletion and wrong linking fail');
SELECT pg_temp.rassert('RA-exact-history', 'check',
  (SELECT count(*) = 2 AND bool_and(to_jsonb(ca) IS NOT DISTINCT FROM original.body) FROM original_history original
   LEFT JOIN public.coach_assessments ca USING(id) WHERE original.id IN (pg_temp.rid(40),pg_temp.rid(41))),
  'Exact adoption and repeat preserve both full original assessment records');
SELECT pg_temp.rassert('RA-typo-history', 'check',
  (SELECT count(*) = 2 AND bool_and(to_jsonb(ca) IS NOT DISTINCT FROM original.body) FROM original_history original
   LEFT JOIN public.coach_assessments ca USING(id) WHERE original.id IN (pg_temp.rid(42),pg_temp.rid(43))),
  'Typo history remains unchanged on its original row, available for verified reconciliation');
SELECT pg_temp.rassert('RA-ambiguous-histories', 'check',
  (SELECT count(*) = 4 AND bool_and(to_jsonb(ca) IS NOT DISTINCT FROM original.body) FROM original_history original
   LEFT JOIN public.coach_assessments ca USING(id) WHERE original.id IN (pg_temp.rid(44),pg_temp.rid(45),pg_temp.rid(46),pg_temp.rid(47))),
  'Both namesakes retain their own exact assessment IDs, values and associations');

SELECT id AS roster_assertion_id, kind, status, detail FROM pg_temp.roster_results ORDER BY id;
ROLLBACK;

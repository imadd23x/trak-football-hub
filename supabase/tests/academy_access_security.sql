-- F1/F6 compatibility: actual authenticated access, immutable academy IDs,
-- legitimate linked-player edits, and independent-coach roster adoption.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing academy-access fixtures outside the disposable test harness';
  END IF;
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

CREATE FUNCTION pg_temp.academy_id(n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('92000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
CREATE FUNCTION pg_temp.academy_assert(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Academy assertion failed: %', description; END IF;
END;
$$;
CREATE FUNCTION pg_temp.academy_denied(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'Expected denied operation: %', description;
END;
$$;

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.academy_id(i), 'academy-access-' || i || '@test.invalid', now()
FROM generate_series(1, 9) i;
INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.academy_id(1), 'club', 'Academy A Admin', NULL),
  (pg_temp.academy_id(2), 'club', 'Academy B Admin', NULL),
  (pg_temp.academy_id(3), 'coach', 'Academy A Coach', 'ACCA03'),
  (pg_temp.academy_id(4), 'coach', 'Academy B Coach', 'ACCA04'),
  (pg_temp.academy_id(5), 'player', 'Linked Adult A', NULL),
  (pg_temp.academy_id(6), 'player', 'Other Adult', NULL),
  (pg_temp.academy_id(7), 'parent', 'Linked Parent', NULL),
  (pg_temp.academy_id(8), 'coach', 'Independent Coach', 'ACCA08'),
  (pg_temp.academy_id(9), 'player', 'Adopt Me', NULL);
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.academy_id(10), pg_temp.academy_id(1), 'Access Academy A', 'ACCESS-A'),
  (pg_temp.academy_id(11), pg_temp.academy_id(2), 'Access Academy B', 'ACCESS-B');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.academy_id(3), pg_temp.academy_id(10)),
  (pg_temp.academy_id(4), pg_temp.academy_id(11)),
  (pg_temp.academy_id(8), NULL);
INSERT INTO public.player_details (user_id, date_of_birth)
SELECT pg_temp.academy_id(i), '2000-01-01'::date FROM unnest(ARRAY[5,6,9]) i;
INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
VALUES (pg_temp.academy_id(5), pg_temp.academy_id(7));
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name) VALUES
  (pg_temp.academy_id(20), pg_temp.academy_id(3), pg_temp.academy_id(5), 'Linked Adult A'),
  -- Trusted fixture for old invalid link data: academy membership must not
  -- expose a guardian's profile merely because a legacy row points at it.
  (pg_temp.academy_id(21), pg_temp.academy_id(3), pg_temp.academy_id(7), 'Legacy wrong-role link'),
  (pg_temp.academy_id(22), pg_temp.academy_id(8), NULL, 'Adopt Me');
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id) VALUES
  (pg_temp.academy_id(30), pg_temp.academy_id(3), pg_temp.academy_id(20)),
  (pg_temp.academy_id(31), pg_temp.academy_id(8), pg_temp.academy_id(22));
INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type)
VALUES (pg_temp.academy_id(40), pg_temp.academy_id(3), pg_temp.academy_id(20), 'effort');

-- A normal coach edit must work after a player has linked themselves.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'authenticated')::text, true);
UPDATE public.squad_players SET shirt_number = 17 WHERE id = pg_temp.academy_id(20);
SELECT pg_temp.academy_assert(
  (SELECT shirt_number = 17 AND linked_player_id = pg_temp.academy_id(5) FROM public.squad_players WHERE id = pg_temp.academy_id(20)),
  'coach can edit an owned linked player without changing the child identity'
);
SELECT pg_temp.academy_denied(
  $$UPDATE public.squad_players SET linked_player_id = pg_temp.academy_id(6) WHERE id = pg_temp.academy_id(20)$$,
  'coach cannot retarget an existing row to another player'
);
SELECT pg_temp.academy_denied($$SELECT public.link_player_to_coach('TRK-ACCA04')$$, 'coach cannot claim a player relationship');

-- A coach in another academy must not edit this row, even by its known UUID.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(4), 'role', 'authenticated')::text, true);
WITH changed AS (UPDATE public.squad_players SET shirt_number = 99 WHERE id = pg_temp.academy_id(20) RETURNING id)
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM changed), 'foreign coach cannot edit the roster');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'authenticated')::text, true);

-- Neither foreign UUIDs nor NULL can defeat organization pinning while the
-- original organization exists. Exercise all three trigger-bearing tables.
UPDATE public.squad_players SET organization_id = pg_temp.academy_id(11) WHERE id = pg_temp.academy_id(20);
UPDATE public.squad_players SET organization_id = NULL WHERE id = pg_temp.academy_id(20);
UPDATE public.coach_assessments SET organization_id = pg_temp.academy_id(11) WHERE id = pg_temp.academy_id(30);
UPDATE public.coach_assessments SET organization_id = NULL WHERE id = pg_temp.academy_id(30);
UPDATE public.recognition_awards SET organization_id = pg_temp.academy_id(11) WHERE id = pg_temp.academy_id(40);
UPDATE public.recognition_awards SET organization_id = NULL WHERE id = pg_temp.academy_id(40);
SELECT pg_temp.academy_assert(
  (SELECT organization_id = pg_temp.academy_id(10) FROM public.squad_players WHERE id = pg_temp.academy_id(20))
  AND (SELECT organization_id = pg_temp.academy_id(10) FROM public.coach_assessments WHERE id = pg_temp.academy_id(30))
  AND (SELECT organization_id = pg_temp.academy_id(10) FROM public.recognition_awards WHERE id = pg_temp.academy_id(40)),
  'direct UPDATE cannot move or clear a valid academy from roster, assessment or award'
);

-- Original academy retains player history, not merely the coach's current org.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_denied($$SELECT public.link_player_to_coach('TRK-ACCA04')$$, 'club admin cannot claim a player relationship');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'current academy reads its player profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'current academy reads its player DOB');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.profiles WHERE user_id = pg_temp.academy_id(7)), 'legacy wrong-role roster link does not reveal parent profile to admin');
SELECT pg_temp.academy_assert(NOT public.player_in_my_org(pg_temp.academy_id(7)), 'helper rejects a non-player legacy target');
SELECT public.remove_coach_from_org(pg_temp.academy_id(3));
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'authenticated')::text, true);
SELECT public.join_organization('ACCESS-B');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'original academy keeps profile access after removal and transfer');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'original academy keeps DOB access after removal and transfer');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(2), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'new academy cannot read former player profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'new academy cannot read former player DOB');

-- Player and verified-link parent reads must remain independent of the coach.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(7), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_denied($$SELECT public.link_player_to_coach('TRK-ACCA04')$$, 'parent cannot claim a player relationship');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'parent retains linked child profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'parent retains linked child DOB');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(5), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'player retains own profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'player retains own details');
SELECT pg_temp.academy_assert(NOT public.player_in_my_org(pg_temp.academy_id(5)), 'direct helper call does not confer admin privileges on player');

-- Independent roster adoption is an existing supported workflow. The coach
-- joins A; the player then uses the code to claim the uniquely named stub.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(8), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT organization_id IS NULL FROM public.squad_players WHERE id = pg_temp.academy_id(22)), 'independent roster starts without academy');
SELECT public.join_organization('ACCESS-A');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(9), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert(public.link_player_to_coach('TRK-ACCA08') = pg_temp.academy_id(22), 'player adopts existing independent roster row');
SELECT pg_temp.academy_assert(public.link_player_to_coach('TRK-ACCA08') = pg_temp.academy_id(22), 'repeated adoption is idempotent');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.coach_assessments WHERE id = pg_temp.academy_id(31)), 'adoption retains assessment history');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT organization_id = pg_temp.academy_id(10) FROM public.squad_players WHERE id = pg_temp.academy_id(22)), 'adopted NULL roster acquires current coach academy');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(9)), 'academy sees newly adopted player');

-- Actual RPC regression: a deleted academy's matching-name stub is history,
-- not a new player's proof of identity or a coach's independent roster.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.academy_id(i), 'academy-closed-' || i || '@test.invalid', now()
FROM generate_series(51, 54) i;
INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.academy_id(51), 'club', 'Closing Admin', NULL),
  (pg_temp.academy_id(52), 'coach', 'Closing Coach', 'ACCA52'),
  (pg_temp.academy_id(53), 'player', 'Same Name After Closure', NULL),
  (pg_temp.academy_id(54), 'player', 'Previously Linked Child', NULL);
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.academy_id(53), '2000-01-01'), (pg_temp.academy_id(54), '2000-01-01');
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.academy_id(55), pg_temp.academy_id(51), 'Closing Academy', 'ACCESS-CLOSED');
INSERT INTO public.coach_details (user_id, organization_id)
VALUES (pg_temp.academy_id(52), pg_temp.academy_id(55));
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.academy_id(60), pg_temp.academy_id(52), 'Same Name After Closure', NULL),
  (pg_temp.academy_id(61), pg_temp.academy_id(52), 'Previously Linked Child', pg_temp.academy_id(54));
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id) VALUES
  (pg_temp.academy_id(70), pg_temp.academy_id(52), pg_temp.academy_id(60)),
  (pg_temp.academy_id(71), pg_temp.academy_id(52), pg_temp.academy_id(61));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(51), 'role', 'authenticated')::text, true);
SELECT public.delete_my_account();
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(52), 'role', 'authenticated')::text, true);
SELECT public.join_organization('ACCESS-B');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.coach_assessments WHERE id IN (pg_temp.academy_id(70), pg_temp.academy_id(71))), 'coach cannot read closed history after joining another academy');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(53), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert(public.link_player_to_coach('TRK-ACCA52') <> pg_temp.academy_id(60), 'same-name player gets a fresh row instead of adopting closed academy history');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.coach_assessments WHERE id = pg_temp.academy_id(70)), 'new player does not inherit closed same-name assessment');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(52), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.coach_assessments WHERE id IN (pg_temp.academy_id(70), pg_temp.academy_id(71))), 'player RPC does not restore coach access to closed history');
WITH changed AS (
  UPDATE public.squad_players SET organization_deleted_at = NULL, status = 'active'
  WHERE id = pg_temp.academy_id(60) RETURNING id
)
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM changed), 'coach cannot clear the closure marker directly');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
-- Even later trusted bookkeeping must not infer B from the coach's current
-- organization, or that would silently transfer old child identity to B.
UPDATE public.squad_players SET shirt_number = 21, organization_deleted_at = NULL,
  organization_id = pg_temp.academy_id(11), status = 'active'
WHERE id IN (pg_temp.academy_id(60), pg_temp.academy_id(61));
SELECT pg_temp.academy_assert(
  (SELECT count(*) = 2 FROM public.squad_players WHERE id IN (pg_temp.academy_id(60), pg_temp.academy_id(61))
   AND organization_deleted_at IS NOT NULL AND organization_id IS NULL AND status = 'coach_departed'),
  'closure marker, cleared org and departed status survive later updates'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(2), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.profiles WHERE user_id = pg_temp.academy_id(54)), 'new academy admin cannot acquire old child profile through a later update');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.player_details WHERE user_id = pg_temp.academy_id(54)), 'new academy admin cannot acquire old child DOB through a later update');

RESET ROLE;
SELECT pg_temp.academy_assert(NOT has_function_privilege('anon', 'public.player_in_my_org(uuid)', 'EXECUTE'), 'anonymous helper execution revoked');
SELECT pg_temp.academy_assert(NOT has_function_privilege('authenticated', 'public.pin_org_id_on_update()', 'EXECUTE'), 'pin trigger is not a caller API');
SELECT pg_temp.academy_assert(NOT has_function_privilege('authenticated', 'public.set_squad_player_org_id()', 'EXECUTE'), 'roster trigger is not a caller API');
ROLLBACK;

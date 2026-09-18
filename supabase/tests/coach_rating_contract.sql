-- The normal assessment form writes six raw scores. PostgreSQL supplies the
-- stored coach_rating on INSERT and recalculates it on UPDATE.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing coach-rating fixtures outside the disposable test harness';
  END IF;
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

CREATE FUNCTION pg_temp.rating_contract_id(n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('97000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
CREATE FUNCTION pg_temp.rating_contract_assert(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Coach-rating assertion failed: %', description;
  END IF;
END;
$$;

-- Trusted fixture setup only; the assessment writes and reads below run with
-- the coach's authenticated identity and the real table policies/triggers.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.rating_contract_id(i), 'synthetic-coach-rating-' || i || '@test.invalid', now()
FROM generate_series(1, 3) i;
INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.rating_contract_id(1), 'club', 'Synthetic Rating Academy Admin', NULL),
  (pg_temp.rating_contract_id(2), 'coach', 'Synthetic Rating Coach', 'RAT970'),
  (pg_temp.rating_contract_id(3), 'player', 'Synthetic Rating Adult', NULL);
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.rating_contract_id(10), pg_temp.rating_contract_id(1), 'Synthetic Rating Academy', 'RATING-970');
INSERT INTO public.coach_details (user_id, organization_id)
VALUES (pg_temp.rating_contract_id(2), pg_temp.rating_contract_id(10));
INSERT INTO public.player_details (user_id, date_of_birth)
VALUES (pg_temp.rating_contract_id(3), '2000-01-01'::date);
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name)
VALUES (pg_temp.rating_contract_id(20), pg_temp.rating_contract_id(2), pg_temp.rating_contract_id(3), 'Synthetic Rating Adult');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', pg_temp.rating_contract_id(2), 'role', 'authenticated'
)::text, true);
SELECT pg_temp.rating_contract_assert(
  current_user = 'authenticated' AND auth.uid() = pg_temp.rating_contract_id(2),
  'assessment operations use the authenticated coach identity'
);
SELECT pg_temp.rating_contract_assert(
  row_security_active('public.coach_assessments'::regclass),
  'assessment operations are subject to row-level security'
);
SELECT pg_temp.rating_contract_assert(
  (SELECT attgenerated = 's' FROM pg_attribute
   WHERE attrelid = 'public.coach_assessments'::regclass
     AND attname = 'coach_rating' AND NOT attisdropped),
  'coach_rating is a stored generated column'
);

-- Deliberately omit coach_rating, matching the routed six-slider form.
INSERT INTO public.coach_assessments (
  id, coach_user_id, squad_player_id,
  work_rate, tactical, attitude, technical, physical, coachability
) VALUES
  (pg_temp.rating_contract_id(30), pg_temp.rating_contract_id(2), pg_temp.rating_contract_id(20), 0, 0, 0, 0, 0, 0),
  (pg_temp.rating_contract_id(31), pg_temp.rating_contract_id(2), pg_temp.rating_contract_id(20), 10, 9, 8, 7, 6, 5);
SELECT pg_temp.rating_contract_assert(
  (SELECT coach_rating = 0 AND organization_id = pg_temp.rating_contract_id(10)
   FROM public.coach_assessments WHERE id = pg_temp.rating_contract_id(30)),
  'six zero scores read back as zero in the coach academy'
);
SELECT pg_temp.rating_contract_assert(
  (SELECT coach_rating = 7.5
   FROM public.coach_assessments WHERE id = pg_temp.rating_contract_id(31)),
  'scores 10, 9, 8, 7, 6, 5 read back as 7.5'
);

UPDATE public.coach_assessments
SET work_rate = 7, tactical = 6, attitude = 6,
    technical = 6, physical = 6, coachability = 6
WHERE id = pg_temp.rating_contract_id(31);
SELECT pg_temp.rating_contract_assert(
  (SELECT coach_rating = 6.2 AND work_rate = 7 AND tactical = 6
          AND attitude = 6 AND technical = 6 AND physical = 6 AND coachability = 6
   FROM public.coach_assessments WHERE id = pg_temp.rating_contract_id(31)),
  'updating raw scores recalculates and rounds the mean to one decimal'
);
SELECT pg_temp.rating_contract_assert(
  (SELECT count(*) = 2 AND count(*) FILTER (
     WHERE id = pg_temp.rating_contract_id(30) AND coach_rating = 0
   ) = 1
   FROM public.coach_assessments
   WHERE squad_player_id = pg_temp.rating_contract_id(20)),
  'the update preserves the other zero-rated assessment without adding rows'
);

SELECT 7 AS coach_rating_assertions;
ROLLBACK;

-- @trak-suite mode=--coach-departure-review in-all=true order=1000
-- Synthetic, committed fixtures for account_deletion_assertions.sql.
-- ONLY the disposable in-memory harness may execute this file. COMMIT is
-- intentional: inserting and deleting in one transaction masked the F6 bug.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing account-deletion fixtures outside the disposable test harness';
  END IF;
END;
$test$;

SELECT set_config('request.jwt.claims', '{}', true);
CREATE FUNCTION pg_temp.account_id(n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('91000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE account_deletion_fixture_marker (setup_xid bigint NOT NULL);
INSERT INTO account_deletion_fixture_marker VALUES (txid_current());

-- 1/2 admins A/B; 3 deleted coach; 4 transferred coach; 5 removed coach;
-- 6 unaffected coach B; 7 deleted player; 8/9 surviving children;
-- 10 deleted parent; 11 surviving parent. All are synthetic verified adults.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.account_id(n), 'account-deletion-' || n || '@test.invalid', now()
FROM generate_series(1, 11) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.account_id(1), 'club', 'Deletion Admin A'),
  (pg_temp.account_id(2), 'club', 'Deletion Admin B'),
  (pg_temp.account_id(3), 'coach', 'Deleted Coach History'),
  (pg_temp.account_id(4), 'coach', 'Transferred Coach'),
  (pg_temp.account_id(5), 'coach', 'Removed Coach'),
  (pg_temp.account_id(6), 'coach', 'Unaffected Coach B'),
  (pg_temp.account_id(7), 'player', 'Deleted Player'),
  (pg_temp.account_id(8), 'player', 'Coach History Child'),
  (pg_temp.account_id(9), 'player', 'Academy History Child'),
  (pg_temp.account_id(10), 'parent', 'Deleted Parent'),
  (pg_temp.account_id(11), 'parent', 'Surviving Parent');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.account_id(101), pg_temp.account_id(1), 'Deletion Academy A', 'DELETE-A'),
  (pg_temp.account_id(102), pg_temp.account_id(2), 'Deletion Academy B', 'DELETE-B');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.account_id(3), pg_temp.account_id(101)),
  (pg_temp.account_id(4), pg_temp.account_id(101)),
  (pg_temp.account_id(5), pg_temp.account_id(101)),
  (pg_temp.account_id(6), pg_temp.account_id(102));
INSERT INTO public.player_details (user_id, date_of_birth)
SELECT pg_temp.account_id(n), '2000-01-01'::date FROM generate_series(7, 9) n;

INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, status) VALUES
  (pg_temp.account_id(201), pg_temp.account_id(6), 'Deleted Player', pg_temp.account_id(7), 'active'),
  (pg_temp.account_id(202), pg_temp.account_id(3), 'Coach History Child', pg_temp.account_id(8), 'active'),
  (pg_temp.account_id(203), pg_temp.account_id(4), 'Academy History Child', pg_temp.account_id(9), 'released'),
  (pg_temp.account_id(204), pg_temp.account_id(5), 'Academy History Child', pg_temp.account_id(9), 'released');
INSERT INTO public.coach_sessions (id, coach_user_id, title)
SELECT pg_temp.account_id(500 + n), pg_temp.account_id(coach), 'Synthetic deletion session ' || n
FROM (VALUES (1,6), (2,3), (3,4), (4,5)) f(n,coach);
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, session_id)
SELECT pg_temp.account_id(300 + n), pg_temp.account_id(coach), pg_temp.account_id(200 + n), pg_temp.account_id(500 + n)
FROM (VALUES (1,6), (2,3), (3,4), (4,5)) f(n,coach);
INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type)
SELECT pg_temp.account_id(400 + n), pg_temp.account_id(coach), pg_temp.account_id(200 + n), 'player_of_week'
FROM (VALUES (1,6), (2,3), (3,4), (4,5)) f(n,coach);
INSERT INTO public.session_attendance (id, session_id, squad_player_id, status)
SELECT pg_temp.account_id(700 + n), pg_temp.account_id(500 + n), pg_temp.account_id(200 + n), 'present'
FROM generate_series(1,4) n;
INSERT INTO public.coach_assessment_notes (id, assessment_id, coach_user_id, note)
SELECT pg_temp.account_id(800 + n), pg_temp.account_id(300 + n), pg_temp.account_id(coach), 'Synthetic private note ' || n
FROM (VALUES (1,6), (2,3), (3,4), (4,5)) f(n,coach);
-- Player deletion must cascade this child's meeting. Coach-owned meetings
-- have no auth FK/coach-deletion cleanup today; that separate residual is not
-- claimed fixed by this FK/history suite.
INSERT INTO public.meeting_requests (id, coach_user_id, squad_player_id, reason)
VALUES (pg_temp.account_id(901), pg_temp.account_id(6), pg_temp.account_id(201), 'Synthetic player meeting');
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group, logged_by, logged_by_role)
SELECT pg_temp.account_id(1000 + n), pg_temp.account_id(n), 'CM', 'Friendly', 'Home', 'Adult', pg_temp.account_id(n), 'player'
FROM generate_series(7,9) n;

INSERT INTO public.staff_compliance (organization_id, coach_user_id)
SELECT organization_id, user_id FROM public.coach_details
WHERE user_id IN (pg_temp.account_id(3), pg_temp.account_id(4), pg_temp.account_id(5), pg_temp.account_id(6));
INSERT INTO public.admin_notes (id, organization_id, admin_user_id, target_type, target_squad_player_id, note)
VALUES (pg_temp.account_id(1101), pg_temp.account_id(101), pg_temp.account_id(1), 'player', pg_temp.account_id(202), 'Synthetic academy note');
INSERT INTO public.admin_notes (id, organization_id, admin_user_id, target_type, target_coach_user_id, note)
VALUES (pg_temp.account_id(1102), pg_temp.account_id(102), pg_temp.account_id(2), 'coach', pg_temp.account_id(6), 'Unaffected academy note');
INSERT INTO public.telemetry_events (user_id, event_type)
SELECT pg_temp.account_id(n), 'synthetic_deletion_fixture' FROM generate_series(1,11) n;

INSERT INTO public.parent_invites (id, player_user_id, parent_email) VALUES
  (pg_temp.account_id(601), pg_temp.account_id(8), 'account-deletion-10@test.invalid'),
  (pg_temp.account_id(602), pg_temp.account_id(9), 'account-deletion-10@test.invalid'),
  (pg_temp.account_id(603), pg_temp.account_id(7), 'account-deletion-11@test.invalid'),
  (pg_temp.account_id(604), pg_temp.account_id(8), 'account-deletion-11@test.invalid'),
  (pg_temp.account_id(605), pg_temp.account_id(9), 'account-deletion-11@test.invalid');
-- Establish real consumed invitations with the actual verified-parent RPC.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(10), 'role', 'authenticated')::text, true);
SELECT public.accept_parent_invite(pg_temp.account_id(601));
SELECT public.accept_parent_invite(pg_temp.account_id(602));
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(11), 'role', 'authenticated')::text, true);
SELECT public.accept_parent_invite(pg_temp.account_id(603));
SELECT public.accept_parent_invite(pg_temp.account_id(604));
SELECT public.accept_parent_invite(pg_temp.account_id(605));
RESET ROLE;
COMMIT;

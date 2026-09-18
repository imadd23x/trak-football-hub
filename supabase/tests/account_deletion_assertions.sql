-- Run after account_deletion_setup.sql has committed, on the SAME disposable
-- connection. Application mutations run as authenticated, not as superuser.
-- Assertion reads after RESET ROLE inspect persistence/FKs without RLS hiding
-- retained rows. The deletions roll back; the harness disposes the database.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing account-deletion tests outside the disposable test harness';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.account_deletion_fixture_marker WHERE setup_xid <> txid_current()) THEN
    RAISE EXCEPTION 'Account-deletion fixtures must COMMIT before assertion transaction';
  END IF;
END;
$test$;

CREATE TEMP TABLE account_deletion_results (assertion text NOT NULL, passed boolean NOT NULL) ON COMMIT DROP;
GRANT INSERT ON account_deletion_results TO authenticated;
CREATE FUNCTION pg_temp.account_check(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.account_deletion_results VALUES (description, ok IS NOT DISTINCT FROM true);
END;
$test$;
CREATE FUNCTION pg_temp.delete_account_check(description text) RETURNS void
LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM public.delete_my_account();
  PERFORM pg_temp.account_check(true, description);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.account_check(false, description || ': ' || SQLSTATE || ' ' || SQLERRM);
END;
$test$;
CREATE FUNCTION pg_temp.account_expect_denied(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE affected bigint;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
      -- Roll back an unexpected successful mutation before recording failure.
      RAISE EXCEPTION 'Unexpected authorized operation' USING ERRCODE = 'ZX001';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM pg_temp.account_check(true, description); RETURN;
    WHEN raise_exception THEN
      IF SQLERRM ~* '^not authori[sz]ed([ :—-]|$)' THEN
        PERFORM pg_temp.account_check(true, description); RETURN;
      END IF;
      RAISE;
    WHEN SQLSTATE 'ZX001' THEN
      PERFORM pg_temp.account_check(false, description); RETURN;
  END;
  PERFORM pg_temp.account_check(affected = 0, description);
END;
$test$;

SELECT pg_temp.account_check((SELECT count(*) = 5 FROM public.player_parent_links WHERE parent_user_id IN (pg_temp.account_id(10),pg_temp.account_id(11))), 'control: five verified parent links were committed');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.coach_assessments WHERE organization_id = pg_temp.account_id(101)), 'control: academy A assessment references were committed');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.recognition_awards WHERE organization_id = pg_temp.account_id(101)), 'control: academy A award references were committed');

-- Player deletion removes that child's records, not another child's history.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(7), 'role', 'authenticated')::text, true);
SELECT pg_temp.delete_account_check('player delete_my_account succeeds');
RESET ROLE;
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.player_details WHERE user_id = pg_temp.account_id(7)), 'deleted player details removed');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.matches WHERE user_id = pg_temp.account_id(7)), 'deleted player matches removed');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.squad_players WHERE linked_player_id = pg_temp.account_id(7)), 'deleted player roster removed');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = pg_temp.account_id(301)), 'deleted player assessment cascades');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.recognition_awards WHERE id = pg_temp.account_id(401)), 'deleted player award cascades');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.coach_assessment_notes WHERE id = pg_temp.account_id(801)), 'deleted player note cascades');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.session_attendance WHERE id = pg_temp.account_id(701)), 'deleted player attendance cascades');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.meeting_requests WHERE id = pg_temp.account_id(901)), 'deleted player meeting cascades');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.parent_invites WHERE player_user_id = pg_temp.account_id(7)), 'deleted player invitations removed');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.player_parent_links WHERE player_user_id = pg_temp.account_id(7)), 'deleted player guardian links removed');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.coach_assessments WHERE id IN (pg_temp.account_id(302),pg_temp.account_id(303),pg_temp.account_id(304))), 'other children assessments survive player deletion');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.coach_sessions WHERE id = pg_temp.account_id(501)), 'player deletion preserves the coach session');

-- Parent deletion removes guardian access while preserving children/records.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(10), 'role', 'authenticated')::text, true);
SELECT pg_temp.delete_account_check('parent delete_my_account succeeds');
RESET ROLE;
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.player_parent_links WHERE parent_user_id = pg_temp.account_id(10)), 'deleted parent links removed');
SELECT pg_temp.account_check((SELECT count(*) = 2 FROM public.player_parent_links WHERE parent_user_id = pg_temp.account_id(11)), 'other guardian keeps both surviving children');
SELECT pg_temp.account_check((SELECT count(*) = 2 FROM public.parent_invites WHERE id IN (pg_temp.account_id(601),pg_temp.account_id(602)) AND status = 'accepted'), 'deleted parent invitations remain consumed');
SELECT pg_temp.account_check((SELECT count(*) = 2 FROM public.player_details WHERE user_id IN (pg_temp.account_id(8),pg_temp.account_id(9))), 'parent deletion preserves child details');
SELECT pg_temp.account_check((SELECT count(*) = 2 FROM public.matches WHERE user_id IN (pg_temp.account_id(8),pg_temp.account_id(9))), 'parent deletion preserves child matches');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.coach_assessments WHERE id IN (pg_temp.account_id(302),pg_temp.account_id(303),pg_temp.account_id(304))), 'parent deletion preserves development history');
-- A replacement account with the same verified email has no old authority.
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO auth.users (id,email,email_confirmed_at) VALUES (pg_temp.account_id(12),'account-deletion-10@test.invalid',now());
INSERT INTO public.profiles (user_id,role,full_name) VALUES (pg_temp.account_id(12),'parent','Replacement Parent');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(12), 'role', 'authenticated')::text, true);
SELECT pg_temp.account_check((SELECT count(*) = 0 FROM public.get_my_pending_parent_invites()), 'replacement parent cannot discover consumed invitations');
SELECT pg_temp.account_expect_denied('SELECT public.accept_parent_invite(pg_temp.account_id(601))', 'replacement parent cannot replay consumed child invitation');
SELECT pg_temp.account_check((SELECT count(*) = 0 FROM public.player_parent_links), 'replacement parent gains no child link');

-- Coach deletion preserves academy-owned child history and attribution.
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(3), 'role', 'authenticated')::text, true);
SELECT pg_temp.delete_account_check('coach delete_my_account succeeds');
RESET ROLE;
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.coach_details WHERE user_id = pg_temp.account_id(3)), 'deleted coach details removed');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.staff_compliance WHERE coach_user_id = pg_temp.account_id(3)), 'deleted coach compliance removed');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.coach_assessment_notes WHERE coach_user_id = pg_temp.account_id(3)), 'deleted coach private notes removed');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.squad_players WHERE id = pg_temp.account_id(202) AND coach_user_id IS NULL AND organization_id = pg_temp.account_id(101)), 'deleted coach roster survives with academy pinned');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = pg_temp.account_id(302) AND coach_user_id IS NULL AND organization_id = pg_temp.account_id(101) AND coach_name_snapshot = 'Deleted Coach History'), 'deleted coach assessment and name snapshot survive');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.recognition_awards WHERE id = pg_temp.account_id(402) AND coach_user_id IS NULL AND organization_id = pg_temp.account_id(101) AND coach_name_snapshot = 'Deleted Coach History'), 'deleted coach award and name snapshot survive');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.coach_sessions WHERE id = pg_temp.account_id(502) AND coach_user_id IS NULL), 'deleted coach session survives');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.session_attendance WHERE id = pg_temp.account_id(702)), 'deleted coach attendance survives');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.profiles WHERE user_id = pg_temp.account_id(8)), 'academy admin keeps child profile after coach deletion');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.player_details WHERE user_id = pg_temp.account_id(8)), 'academy admin keeps child DOB after coach deletion');

-- Released records must remain inaccessible after removal, transfer AND the
-- original academy's deletion. Do not assert a particular status spelling.
SELECT public.remove_coach_from_org(pg_temp.account_id(4));
SELECT public.remove_coach_from_org(pg_temp.account_id(5));
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(4), 'role', 'authenticated')::text, true);
SELECT public.join_organization('DELETE-B');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.squad_players WHERE id = pg_temp.account_id(203)), 'transferred coach cannot read released academy A row before deletion');
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(5), 'role', 'authenticated')::text, true);
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.squad_players WHERE id = pg_temp.account_id(204)), 'removed coach cannot read released academy A row before deletion');

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.delete_account_check('club admin delete_my_account succeeds with committed organization references');
RESET ROLE;
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = pg_temp.account_id(101)), 'deleted academy removed');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.squad_players WHERE id IN (pg_temp.account_id(202),pg_temp.account_id(203),pg_temp.account_id(204)) AND organization_id IS NULL), 'academy deletion preserves all roster rows and clears organization FKs');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.coach_assessments WHERE id IN (pg_temp.account_id(302),pg_temp.account_id(303),pg_temp.account_id(304)) AND organization_id IS NULL), 'academy deletion preserves all assessments and clears organization FKs');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.recognition_awards WHERE id IN (pg_temp.account_id(402),pg_temp.account_id(403),pg_temp.account_id(404)) AND organization_id IS NULL), 'academy deletion preserves all awards and clears organization FKs');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.admin_notes WHERE admin_user_id = pg_temp.account_id(1)), 'deleted admin notes removed');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.staff_compliance WHERE organization_id = pg_temp.account_id(101)), 'deleted academy compliance removed');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.organizations WHERE id = pg_temp.account_id(102)) AND EXISTS (SELECT 1 FROM public.admin_notes WHERE id = pg_temp.account_id(1102)), 'unrelated academy and admin note remain');
SELECT pg_temp.account_check(EXISTS (SELECT 1 FROM public.coach_details WHERE user_id = pg_temp.account_id(4) AND organization_id = pg_temp.account_id(102)), 'transferred coach retains new academy membership');
SELECT pg_temp.account_check((SELECT count(*) = 7 FROM auth.users WHERE id IN (pg_temp.account_id(2),pg_temp.account_id(4),pg_temp.account_id(5),pg_temp.account_id(6),pg_temp.account_id(8),pg_temp.account_id(9),pg_temp.account_id(11))), 'all unrelated accounts survive four role deletions');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.session_attendance WHERE id IN (pg_temp.account_id(702),pg_temp.account_id(703),pg_temp.account_id(704))), 'academy deletion preserves child attendance');

SET LOCAL ROLE authenticated;
DO $test$
DECLARE coach integer; roster integer;
BEGIN
  FOR coach IN 4..5 LOOP
    roster := 199 + coach;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(coach), 'role', 'authenticated')::text, true);
    PERFORM pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.squad_players WHERE id = pg_temp.account_id(roster)), 'departed coach ' || coach || ' cannot regain released roster after academy deletion');
    PERFORM pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE squad_player_id = pg_temp.account_id(roster)), 'departed coach ' || coach || ' cannot read old assessments after academy deletion');
    PERFORM pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.recognition_awards WHERE squad_player_id = pg_temp.account_id(roster)), 'departed coach ' || coach || ' cannot read old awards after academy deletion');
    PERFORM pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.session_attendance WHERE squad_player_id = pg_temp.account_id(roster)), 'departed coach ' || coach || ' cannot read old attendance after academy deletion');
    PERFORM pg_temp.account_expect_denied(format('UPDATE public.squad_players SET shirt_number=17 WHERE id=%L::uuid', pg_temp.account_id(roster)), 'departed coach ' || coach || ' cannot mutate old roster after academy deletion');
    PERFORM pg_temp.account_expect_denied(format('INSERT INTO public.coach_assessments(coach_user_id,squad_player_id) VALUES(%L::uuid,%L::uuid)', pg_temp.account_id(coach), pg_temp.account_id(roster)), 'departed coach ' || coach || ' cannot assess after academy deletion');
    PERFORM pg_temp.account_expect_denied(format('INSERT INTO public.recognition_awards(coach_user_id,squad_player_id,award_type) VALUES(%L::uuid,%L::uuid,''player_of_week'')', pg_temp.account_id(coach), pg_temp.account_id(roster)), 'departed coach ' || coach || ' cannot award after academy deletion');
    PERFORM pg_temp.account_expect_denied('SELECT public.log_match_for_player(pg_temp.account_id(9),''Synthetic'',1,0,''Friendly'',''Home'',''CM'',''Adult'',90,0,0,''none'',''fit'',''good'',6.0,CURRENT_DATE)', 'departed coach ' || coach || ' cannot log child match after academy deletion');
  END LOOP;
END;
$test$;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(9), 'role', 'authenticated')::text, true);
SELECT pg_temp.account_check((SELECT count(*) = 2 FROM public.coach_assessments WHERE id IN (pg_temp.account_id(303),pg_temp.account_id(304))), 'child can still read own historical assessments after academy deletion');
SELECT pg_temp.account_check((SELECT count(*) = 2 FROM public.recognition_awards WHERE id IN (pg_temp.account_id(403),pg_temp.account_id(404))), 'child can still read own historical awards after academy deletion');
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.account_id(11), 'role', 'authenticated')::text, true);
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.coach_assessments WHERE id IN (pg_temp.account_id(302),pg_temp.account_id(303),pg_temp.account_id(304))), 'surviving parent retains both children assessment histories');
SELECT pg_temp.account_check((SELECT count(*) = 3 FROM public.recognition_awards WHERE id IN (pg_temp.account_id(402),pg_temp.account_id(403),pg_temp.account_id(404))), 'surviving parent retains both children award histories');
SELECT pg_temp.account_check((SELECT count(*) = 0 FROM public.coach_assessment_notes WHERE id IN (pg_temp.account_id(803),pg_temp.account_id(804))), 'surviving parent cannot read private notes');
RESET ROLE;

SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (pg_temp.account_id(1),pg_temp.account_id(3),pg_temp.account_id(7),pg_temp.account_id(10))), 'all four deleted auth accounts are gone');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id IN (pg_temp.account_id(1),pg_temp.account_id(3),pg_temp.account_id(7),pg_temp.account_id(10))), 'all four deleted profiles are gone');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.telemetry_events WHERE user_id IN (pg_temp.account_id(1),pg_temp.account_id(3),pg_temp.account_id(7),pg_temp.account_id(10))), 'telemetry cascades for all four deleted roles');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.squad_players sp LEFT JOIN public.organizations o ON o.id=sp.organization_id WHERE sp.organization_id IS NOT NULL AND o.id IS NULL), 'no orphan roster organization references');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.coach_assessments ca LEFT JOIN public.organizations o ON o.id=ca.organization_id WHERE ca.organization_id IS NOT NULL AND o.id IS NULL), 'no orphan assessment organization references');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.recognition_awards ra LEFT JOIN public.organizations o ON o.id=ra.organization_id WHERE ra.organization_id IS NOT NULL AND o.id IS NULL), 'no orphan award organization references');
SELECT pg_temp.account_check(NOT EXISTS (SELECT 1 FROM public.player_parent_links l LEFT JOIN auth.users p ON p.id=l.player_user_id LEFT JOIN auth.users g ON g.id=l.parent_user_id WHERE p.id IS NULL OR g.id IS NULL), 'no orphan parent-player links');
-- Consent evidence intentionally has no account FKs. Retention policy and
-- avatar object cleanup are not assertions of this database deletion suite.

DO $test$
DECLARE failures text;
BEGIN
  SELECT string_agg(assertion, E'\n' ORDER BY assertion) INTO failures
  FROM pg_temp.account_deletion_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION E'Account-deletion assertions failed:\n%', failures;
  END IF;
END;
$test$;
SELECT count(*) AS account_deletion_checks_passed FROM pg_temp.account_deletion_results;
ROLLBACK;

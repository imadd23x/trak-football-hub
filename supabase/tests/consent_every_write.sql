-- @trak-suite mode=--consent-every-write-review in-all=true
-- G1 (MVP Requirements): no development record exists about an under-18
-- without active consent, on every write path. G6: withdrawal stops
-- processing at once, and the coach can still retract what was published.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- Real accounts through the app's own calls: a coach, a 15-year-old who joins
-- with the coach's code, and the parent who accepts the invite and approves.
-- Every write the coach made while consent was active is then tried again
-- after withdrawal. Each "refused" has an "allowed" beside it (before
-- withdrawal, and again after re-approval), so a gate that is simply shut, or
-- a statement that is simply broken, cannot pass.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing consent-every-write fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ce(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ce_results (description text, passed boolean, detail text);
GRANT INSERT ON ce_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ce_assert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.ce_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

-- Refused means an RLS/privilege refusal or the RPC's own refusal. Success, or
-- any other error, is a failure with its SQLSTATE.
CREATE FUNCTION pg_temp.ce_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege OR raise_exception THEN ok := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.ce_results VALUES (description, ok, failure);
END;
$test$;

-- Allowed means it ran and touched exactly the rows expected.
CREATE FUNCTION pg_temp.ce_allowed(statement text, expected_rows integer, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE n integer; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> expected_rows THEN failure := n || ' row(s), expected ' || expected_rows; END IF;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.ce_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.ce_as(p_uid uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text, 'email', p_email)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.ce_consent() RETURNS void LANGUAGE sql AS $test$
  SELECT public.record_parental_consent(
    p_player_user_id => pg_temp.ce(20),
    p_relationship   => 'parent',
    p_purposes       => '{"coaching_records":true,"recognition":true,"parent_visibility":true}'::jsonb,
    p_notice_version => '2026-09-12.1',
    p_consent_text   => 'I confirm I hold parental responsibility for this child and I authorise the processing I have selected above. I understand I can withdraw at any time from my profile, and that withdrawing stops future processing.');
$test$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.ce(1),  'admin@consent-every-write.test',  now()),
  (pg_temp.ce(10), 'coach@consent-every-write.test',  now()),
  (pg_temp.ce(20), 'player@consent-every-write.test', now()),
  (pg_temp.ce(21), 'adult@consent-every-write.test',  now()),
  (pg_temp.ce(30), 'parent@consent-every-write.test', now());

INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.ce(100), pg_temp.ce(1), 'Every Write FC', 'CEVW01');

SET LOCAL ROLE authenticated;

-- ── Setup: coach, 15-year-old player, parent linked and approving ───────────

SELECT pg_temp.ce_as(pg_temp.ce(10), 'coach@consent-every-write.test');
DO $test$
DECLARE v_sp uuid; v_code text;
BEGIN
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'coach', 'full_name', 'Every Write Coach',
    'coach_details', jsonb_build_object('academy_code', 'CEVW01', 'current_club', 'Every Write FC')));
  SELECT invite_code INTO v_code FROM public.profiles WHERE user_id = pg_temp.ce(10);
  PERFORM set_config('trak.ce_code', v_code, true);
  INSERT INTO public.squad_players (coach_user_id, player_name, status)
  VALUES (pg_temp.ce(10), 'Ada Synthetic', 'active') RETURNING id INTO v_sp;
  PERFORM set_config('trak.ce_sp', v_sp::text, true);
END;
$test$;

SELECT pg_temp.ce_as(pg_temp.ce(20), 'player@consent-every-write.test');
DO $test$
BEGIN
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'player', 'full_name', 'Ada Synthetic',
    'parent_email', 'parent@consent-every-write.test',
    'player_details', jsonb_build_object('date_of_birth', (current_date - interval '15 years 2 months')::date::text,
                                         'position', 'Defender')));
  PERFORM public.link_player_to_coach(current_setting('trak.ce_code'));
END;
$test$;

SELECT pg_temp.ce_as(pg_temp.ce(30), 'parent@consent-every-write.test');
DO $test$
DECLARE v_invite uuid;
BEGIN
  SELECT invite_id INTO v_invite FROM public.get_my_pending_parent_invites() LIMIT 1;
  PERFORM public.provision_my_profile(jsonb_build_object('role', 'parent', 'full_name', 'Parent Synthetic', 'nationality', NULL));
  PERFORM public.accept_parent_invite(v_invite);
  PERFORM pg_temp.ce_consent();
END;
$test$;

-- ── 1. With consent: every coach write is allowed ───────────────────────────

SELECT pg_temp.ce_as(pg_temp.ce(10), 'coach@consent-every-write.test');
DO $test$
DECLARE v_sp uuid := current_setting('trak.ce_sp')::uuid; v_a1 uuid; v_a2 uuid; v_s1 uuid; v_award uuid;
BEGIN
  PERFORM pg_temp.ce_assert(public.coach_squad_player_consent_required(v_sp) IS FALSE,
    '1 setup: the parent''s approval is active');
  INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
  VALUES (pg_temp.ce(10), v_sp, 7,7,7,7,7,7) RETURNING id INTO v_a1;
  INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
  VALUES (pg_temp.ce(10), v_sp, 6,6,6,6,6,6) RETURNING id INTO v_a2;
  INSERT INTO public.coach_assessment_notes (assessment_id, coach_user_id, note) VALUES (v_a1, pg_temp.ce(10), 'first touch');
  INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at)
  VALUES (v_a1, pg_temp.ce(10), 'Great week, Ada.', now());
  INSERT INTO public.coach_sessions (coach_user_id, session_type, title, session_date)
  VALUES (pg_temp.ce(10), 'training', 'Tuesday training', current_date) RETURNING id INTO v_s1;
  INSERT INTO public.session_attendance (session_id, squad_player_id, status) VALUES (v_s1, v_sp, 'present');
  INSERT INTO public.recognition_awards (coach_user_id, squad_player_id, award_type)
  VALUES (pg_temp.ce(10), v_sp, 'player_of_week') RETURNING id INTO v_award;
  PERFORM public.log_match_for_player(pg_temp.ce(20), 'Rivals FC', 2, 1, 'League', 'Home',
    'Defender', 'U16', 60, 0, 1, NULL, NULL, NULL, 6.5, current_date);
  PERFORM set_config('trak.ce_a1', v_a1::text, true);
  PERFORM set_config('trak.ce_a2', v_a2::text, true);
  PERFORM set_config('trak.ce_s1', v_s1::text, true);
  PERFORM set_config('trak.ce_award', v_award::text, true);
  PERFORM pg_temp.ce_assert(true, '1 with consent the coach assesses, notes, publishes, takes attendance, awards and logs a match');
END;
$test$;
SELECT pg_temp.ce_allowed(format('UPDATE public.coach_assessments SET work_rate = 8 WHERE id = %L', current_setting('trak.ce_a1')), 1,
  '1 CONTROL with consent the coach can edit an assessment');

-- ── 2. The parent withdraws ────────────────────────────────────────────────

SELECT pg_temp.ce_as(pg_temp.ce(30), 'parent@consent-every-write.test');
SELECT pg_temp.ce_assert(public.withdraw_parental_consent(pg_temp.ce(20)) >= 1, '2 the parent withdraws');

-- ── 3. After withdrawal: every coach write about the child is refused ──────

SELECT pg_temp.ce_as(pg_temp.ce(10), 'coach@consent-every-write.test');
SELECT pg_temp.ce_refused(format('UPDATE public.coach_assessments SET work_rate = 3 WHERE id = %L', current_setting('trak.ce_a1')),
  '3 G1 the coach cannot edit an assessment after withdrawal');
SELECT pg_temp.ce_refused(format('UPDATE public.coach_assessment_notes SET note = %L WHERE assessment_id = %L', 'later thought', current_setting('trak.ce_a1')),
  '3 G1 the coach cannot edit a private note after withdrawal');
SELECT pg_temp.ce_refused(format('INSERT INTO public.coach_assessment_notes (assessment_id, coach_user_id, note) VALUES (%L, %L, %L)',
  current_setting('trak.ce_a2'), pg_temp.ce(10), 'new note'),
  '3 G1 the coach cannot add a private note after withdrawal');
SELECT pg_temp.ce_refused(format('INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at) VALUES (%L, %L, %L, now())',
  current_setting('trak.ce_a2'), pg_temp.ce(10), 'A new message'),
  '3 G1 the coach cannot publish a new message after withdrawal');
SELECT pg_temp.ce_refused(format('UPDATE public.coach_shared_feedback SET body = %L, published_at = now() WHERE assessment_id = %L',
  'Edited and republished', current_setting('trak.ce_a1')),
  '3 G1 the coach cannot edit and republish a message after withdrawal');
SELECT pg_temp.ce_refused(format('INSERT INTO public.session_attendance (session_id, squad_player_id, status) VALUES (%L, %L, %L)',
  current_setting('trak.ce_s1'), current_setting('trak.ce_sp'), 'late'),
  '3 G1 the coach cannot record attendance after withdrawal');
SELECT pg_temp.ce_refused(format('UPDATE public.session_attendance SET status = %L WHERE session_id = %L', 'absent', current_setting('trak.ce_s1')),
  '3 G1 the coach cannot change attendance after withdrawal');
SELECT pg_temp.ce_refused(format('UPDATE public.recognition_awards SET awarded_for = %L WHERE id = %L', 'edited', current_setting('trak.ce_award')),
  '3 G1 the coach cannot edit an award after withdrawal');
SELECT pg_temp.ce_refused(format($$SELECT public.log_match_for_player(%L, 'Rivals FC', 1, 1, 'League', 'Away', 'Defender', 'U16', 45, 0, 0, NULL, NULL, NULL, 6.0, current_date)$$,
  pg_temp.ce(20)),
  '3 G1 log_match_for_player refuses a child without consent');
-- G6: the coach must still be able to take back what the family could see.
SELECT pg_temp.ce_allowed(format('UPDATE public.coach_shared_feedback SET published_at = NULL WHERE assessment_id = %L', current_setting('trak.ce_a1')), 1,
  '3 G6 CONTROL after withdrawal the coach can still retract the published message');
-- Retraction must not carry new text (Tarek's #123 review).
SELECT pg_temp.ce_refused(format('UPDATE public.coach_shared_feedback SET body = %L WHERE assessment_id = %L',
  'Changed after withdrawal', current_setting('trak.ce_a1')),
  '3 G6 changing an unpublished draft after withdrawal is refused');
SELECT pg_temp.ce_refused(format('UPDATE public.coach_shared_feedback SET body = %L, published_at = NULL WHERE assessment_id = %L',
  'Changed while retracting', current_setting('trak.ce_a1')),
  '3 G6 mixing body changes with retraction after withdrawal is refused');

-- ── 3b. Unknown age fails closed (MVP J1: a missing DOB counts as a minor) ──

-- A roster row with no account behind it cannot hold consent.
DO $test$
DECLARE v_sp uuid;
BEGIN
  INSERT INTO public.squad_players (coach_user_id, player_name, status)
  VALUES (pg_temp.ce(10), 'Unknown Age Synthetic', 'active') RETURNING id INTO v_sp;
  PERFORM set_config('trak.ce_unknown', v_sp::text, true);
END;
$test$;
SELECT pg_temp.ce_refused(format('INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability) VALUES (%L, %L, 7,7,7,7,7,7)',
  pg_temp.ce(10), current_setting('trak.ce_unknown')),
  '3b G1 an unlinked, unknown-age child cannot be assessed without consent');
SELECT pg_temp.ce_refused(format('INSERT INTO public.session_attendance (session_id, squad_player_id, status) VALUES (%L, %L, %L)',
  current_setting('trak.ce_s1'), current_setting('trak.ce_unknown'), 'present'),
  '3b G1 an unlinked, unknown-age child cannot get attendance without consent');

-- A linked 19-year-old needs no guardian; the same player with the DOB gone does.
SELECT pg_temp.ce_as(pg_temp.ce(21), 'adult@consent-every-write.test');
DO $test$
BEGIN
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'player', 'full_name', 'Adult Synthetic',
    'player_details', jsonb_build_object('date_of_birth', (current_date - interval '19 years')::date::text,
                                         'position', 'Forward')));
  PERFORM public.link_player_to_coach(current_setting('trak.ce_code'));
END;
$test$;
SELECT pg_temp.ce_as(pg_temp.ce(10), 'coach@consent-every-write.test');
SELECT set_config('trak.ce_adult_sp',
  (SELECT id::text FROM public.squad_players WHERE linked_player_id = pg_temp.ce(21)), true);
SELECT pg_temp.ce_allowed(format('INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability) VALUES (%L, %L, 7,7,7,7,7,7)',
  pg_temp.ce(10), current_setting('trak.ce_adult_sp')), 1,
  '3b CONTROL a linked 19-year-old is assessed without a guardian');
RESET ROLE;
UPDATE public.player_details SET date_of_birth = NULL WHERE user_id = pg_temp.ce(21);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ce_refused(format('INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability) VALUES (%L, %L, 6,6,6,6,6,6)',
  pg_temp.ce(10), current_setting('trak.ce_adult_sp')),
  '3b G1 a linked player with no date of birth is treated as a minor');

-- ── 4. The child cannot write match records about themselves ──────────────

SELECT pg_temp.ce_as(pg_temp.ce(20), 'player@consent-every-write.test');
-- A row valid in every other respect, so only the write policy can refuse it.
SELECT pg_temp.ce_refused(format($$INSERT INTO public.matches (user_id, opponent, team_score, opponent_score, competition, venue, position, age_group, minutes_played, goals, assists)
  VALUES (%L, 'Self FC', 2, 0, 'League', 'Home', 'Defender', 'U16', 90, 1, 0)$$, pg_temp.ce(20)),
  '4 G1 the child cannot insert a match record about themselves (player logging is cut)');
SELECT pg_temp.ce_refused(format($$UPDATE public.matches SET opponent = 'Renamed FC' WHERE user_id = %L$$, pg_temp.ce(20)),
  '4 G1 the child cannot change the match the coach logged');

-- ── 5. Re-approval opens the same writes again ─────────────────────────────

SELECT pg_temp.ce_as(pg_temp.ce(30), 'parent@consent-every-write.test');
SELECT pg_temp.ce_consent();
SELECT pg_temp.ce_as(pg_temp.ce(10), 'coach@consent-every-write.test');
SELECT pg_temp.ce_allowed(format('UPDATE public.coach_assessment_notes SET note = %L WHERE assessment_id = %L', 'after re-approval', current_setting('trak.ce_a1')), 1,
  '5 CONTROL after re-approval the coach can edit the private note again');
SELECT pg_temp.ce_allowed(format('UPDATE public.coach_shared_feedback SET body = %L, published_at = now() WHERE assessment_id = %L',
  'Republished after re-approval', current_setting('trak.ce_a1')), 1,
  '5 CONTROL after re-approval the coach can republish the message');
SELECT pg_temp.ce_allowed(format($$SELECT public.log_match_for_player(%L, 'Rivals FC', 1, 1, 'League', 'Away', 'Defender', 'U16', 45, 0, 0, NULL, NULL, NULL, 6.0, current_date)$$,
  pg_temp.ce(20)), 1,
  '5 CONTROL after re-approval log_match_for_player accepts the child again');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- Nothing refused in step 3 reached the table.
DO $test$
DECLARE v_matches integer; v_note text; v_attendance text;
BEGIN
  SELECT count(*) INTO v_matches FROM public.matches WHERE user_id = pg_temp.ce(20);
  PERFORM pg_temp.ce_assert(v_matches = 2, '6 exactly two match records exist: before withdrawal and after re-approval',
    v_matches || ' match row(s)');
  SELECT status INTO v_attendance FROM public.session_attendance WHERE session_id = current_setting('trak.ce_s1')::uuid;
  PERFORM pg_temp.ce_assert(v_attendance = 'present', '6 the refused attendance change left the record as it was',
    coalesce(v_attendance, 'null'));
END;
$test$;

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.ce_results;
  IF total <> 27 THEN
    RAISE EXCEPTION 'Consent on every write: % assertions ran; expected exactly 27', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Consent on every write: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.ce_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Consent on every write: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

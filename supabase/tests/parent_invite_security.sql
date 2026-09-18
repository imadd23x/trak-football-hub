-- Execute against a DISPOSABLE database after replaying migrations.
-- The harness must SET trak.test_database = 'disposable' on this connection.
-- These tests execute real RPCs and RLS under authenticated/anon roles; no mocks.
-- All fixtures and successful calls are rolled back.
BEGIN;

DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing to run parent-invite fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Assertion failed: %', description;
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.expect_denied(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'Expected insufficient_privilege: %', description;
END;
$test$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 'child1@p1.test', now()),
  ('10000000-0000-0000-0000-000000000002', 'child2@p1.test', now()),
  ('10000000-0000-0000-0000-000000000003', 'newchild@p1.test', now()),
  ('20000000-0000-0000-0000-000000000001', 'parent1@p1.test', now()),
  ('20000000-0000-0000-0000-000000000002', 'parent2@p1.test', now()),
  ('20000000-0000-0000-0000-000000000003', 'unverified@p1.test', null),
  ('20000000-0000-0000-0000-000000000004', 'newparent@p1.test', now()),
  ('20000000-0000-0000-0000-000000000005', 'newunverified@p1.test', null),
  ('30000000-0000-0000-0000-000000000001', 'coach@p1.test', now());

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'player', 'Test Child One'),
  ('10000000-0000-0000-0000-000000000002', 'player', 'Test Child Two'),
  ('20000000-0000-0000-0000-000000000001', 'parent', 'Test Parent One'),
  ('20000000-0000-0000-0000-000000000002', 'parent', 'Test Parent Two'),
  ('20000000-0000-0000-0000-000000000003', 'parent', 'Unverified Parent'),
  ('30000000-0000-0000-0000-000000000001', 'coach', 'Test Coach');

INSERT INTO public.parent_invites (id, player_user_id, parent_email, invite_token, created_at) VALUES
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'parent1@p1.test', '50000000-0000-0000-0000-000000000001', now()),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'parent1@p1.test', '50000000-0000-0000-0000-000000000002', now()),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'unverified@p1.test', '50000000-0000-0000-0000-000000000003', now()),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'newparent@p1.test', '50000000-0000-0000-0000-000000000004', now()),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'newunverified@p1.test', '50000000-0000-0000-0000-000000000005', now()),
  -- Old create_parent_invite allowed coaches to issue invitations. Fail closed.
  ('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', 'parent1@p1.test', '50000000-0000-0000-0000-000000000006', now());

-- Reproduce the original breach with a real authenticated call first.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","email":"parent2@p1.test","role":"authenticated"}', true);
SELECT pg_temp.expect_denied(
  $$SELECT public.link_parent_to_players_by_email('parent1@p1.test')$$,
  'a parent must not claim invitations addressed to another verified email'
);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.player_parent_links), 'failed foreign-email claim leaves no link');
SELECT pg_temp.expect_denied(
  $$SELECT public.accept_parent_invite('40000000-0000-0000-0000-000000000001')$$,
  'knowing an invite id does not grant recipient access'
);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_parent_invite_by_token('50000000-0000-0000-0000-000000000001')), 'foreign recipient cannot read invite by token');

-- JWT email is user input at the SQL test boundary; the RPC must use auth.users.
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","email":"parent1@p1.test","role":"authenticated"}', true);
SELECT pg_temp.expect_denied($$SELECT public.link_parent_to_players_by_email('parent1@p1.test')$$, 'JWT email cannot override stored verified address');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_my_pending_parent_invite()), 'tokenless lookup uses stored address');

-- An email match is insufficient for a player, coach or unconfirmed parent.
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.expect_denied($$SELECT public.link_parent_to_players_by_email('child1@p1.test')$$, 'player cannot claim parent links');
SELECT pg_temp.expect_denied(
  $$INSERT INTO public.player_parent_links (player_user_id,parent_user_id) VALUES ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001')$$,
  'direct link insertion stays blocked'
);
SELECT pg_temp.expect_denied(
  $$INSERT INTO public.parent_invites (player_user_id,parent_email,status) VALUES ('10000000-0000-0000-0000-000000000001','attacker@p1.test','accepted')$$,
  'players cannot bypass invitation defaults through direct insert'
);
SELECT pg_temp.expect_denied(
  $$UPDATE public.parent_invites SET parent_email='attacker@p1.test', invite_token=gen_random_uuid() WHERE id='40000000-0000-0000-0000-000000000001'$$,
  'creator cannot tamper with an existing invitation'
);
SELECT set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.expect_denied($$SELECT public.link_parent_to_players_by_email('coach@p1.test')$$, 'coach cannot claim parent links');
SELECT pg_temp.expect_denied($$SELECT public.create_parent_invite('parent1@p1.test')$$, 'coach cannot issue player invitations');
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT pg_temp.expect_denied($$SELECT public.link_parent_to_players_by_email('unverified@p1.test')$$, 'unconfirmed email cannot establish a guardian link');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_my_pending_parent_invite()), 'unconfirmed recipient cannot discover child details');

-- Parent cannot retarget a legitimate invitation to a different child.
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","email":"parent1@p1.test","role":"authenticated"}', true);
SELECT pg_temp.expect_denied(
  $$UPDATE public.parent_invites SET player_user_id='10000000-0000-0000-0000-000000000002' WHERE id='40000000-0000-0000-0000-000000000001'$$,
  'recipient cannot change child ownership via direct UPDATE'
);
SELECT pg_temp.expect_denied($$SELECT public.create_parent_invite('other@p1.test')$$, 'parent cannot issue a player invitation');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.get_my_pending_parent_invites()), 'all eligible children appear and legacy non-player invitations stay hidden');
SELECT pg_temp.expect_denied($$SELECT public.accept_parent_invite('40000000-0000-0000-0000-000000000006')$$, 'legacy invitation from non-player cannot establish child link');

-- Existing parents accept a particular child, idempotently, then claim another.
SELECT public.accept_parent_invite('40000000-0000-0000-0000-000000000001');
SELECT public.accept_parent_invite('40000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.player_parent_links), 'repeated acceptance produces one link');
SELECT pg_temp.assert_true(public.link_parent_to_players_by_email('  PARENT1@P1.TEST  ') = 1, 'legacy caller claims the remaining child with normalized email');
SELECT pg_temp.assert_true(public.link_parent_to_players_by_email('parent1@p1.test') = 0, 'repeated legacy claim creates no duplicates');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.player_parent_links), 'existing parent can link two children');

-- A tokenless first-time parent is discoverable before profile creation.
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_my_pending_parent_invite()), 'verified profileless parent has recovery path');
SELECT pg_temp.expect_denied($$SELECT public.accept_parent_invite('40000000-0000-0000-0000-000000000004')$$, 'claim requires parent profile');
SELECT public.provision_my_profile('{"role":"parent","full_name":"New Test Parent"}'::jsonb);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.player_parent_links), 'atomic provisioning creates profile before safe legacy claim');
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT pg_temp.expect_denied($$SELECT public.provision_my_profile('{"role":"parent","full_name":"Unverified New Parent"}'::jsonb)$$, 'unverified parent provisioning cannot link');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.profiles), 'failed provisioning rolls back its profile insert');

-- The player provisioning path still issues the invitation inside its transaction.
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT public.provision_my_profile('{"role":"player","full_name":"New Test Child","player_details":{"date_of_birth":"2013-01-01","position":"CM","age_group":"U15"},"parent_email":"  NewGuardian@P1.TEST  "}'::jsonb);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_player_invites_for_current_user()), 'player provisioning issues one normalized invitation');
SELECT public.create_parent_invite('newguardian@p1.test');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_player_invites_for_current_user()), 'repeating creation is idempotent');
SELECT pg_temp.assert_true((SELECT parent_email='newguardian@p1.test' FROM public.get_player_invites_for_current_user()), 'recipient is normalized server-side');

-- Expiry, stable creation, explicit resend rotation and ownership.
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT public.create_parent_invite('parent2@p1.test');
RESET ROLE;
DO $test$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.parent_invites WHERE player_user_id='10000000-0000-0000-0000-000000000002' AND parent_email='parent2@p1.test';
  PERFORM set_config('trak.test_invite', v_id::text, true);
  PERFORM set_config('trak.test_old_token', (SELECT invite_token::text FROM public.parent_invites WHERE id=v_id), true);
  PERFORM pg_temp.assert_true((SELECT expires_at = now() + interval '7 days' FROM public.parent_invites WHERE id=v_id), 'server creates seven-day expiry');
  UPDATE public.parent_invites SET expires_at=now() - interval '1 second' WHERE id=v_id;
END;
$test$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_my_pending_parent_invite()), 'tokenless recovery excludes expired invite');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_parent_invite_by_token(current_setting('trak.test_old_token')::uuid)), 'token lookup excludes expired invite');
SELECT pg_temp.expect_denied($$SELECT public.accept_parent_invite(current_setting('trak.test_invite')::uuid)$$, 'expired invite cannot be accepted');
SELECT pg_temp.assert_true(public.link_parent_to_players_by_email('parent2@p1.test') = 0, 'legacy email claim excludes expiry');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.expect_denied($$SELECT public.resend_parent_invite(current_setting('trak.test_invite')::uuid)$$, 'other player cannot resend');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT public.resend_parent_invite(current_setting('trak.test_invite')::uuid);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT invite_token::text <> current_setting('trak.test_old_token') AND expires_at = now() + interval '7 days' FROM public.parent_invites WHERE id=current_setting('trak.test_invite')::uuid), 'resend rotates token and renews server expiry');
SELECT set_config('trak.test_new_token', (SELECT invite_token::text FROM public.parent_invites WHERE id=current_setting('trak.test_invite')::uuid), true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_parent_invite_by_token(current_setting('trak.test_old_token')::uuid)), 'old token is invalid after resend');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_parent_invite_by_token(current_setting('trak.test_new_token')::uuid)), 'replacement token resolves for its verified recipient');
SELECT public.accept_parent_invite(current_setting('trak.test_invite')::uuid);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.player_parent_links), 'resent invite may be accepted by verified recipient');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT status='accepted' FROM public.resend_parent_invite(current_setting('trak.test_invite')::uuid)), 'resend never reopens accepted invitation');
SELECT pg_temp.assert_true((SELECT invite_token::text=current_setting('trak.test_new_token') FROM public.create_parent_invite('parent2@p1.test')), 'creation does not rotate an already accepted invite');

-- Successful acceptance is retryable after expiry, but a recycled email must
-- not let a different account acquire an already-consumed invitation.
RESET ROLE;
UPDATE public.parent_invites SET expires_at=now() - interval '1 second'
WHERE id=current_setting('trak.test_invite')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT pg_temp.assert_true(public.accept_parent_invite(current_setting('trak.test_invite')::uuid)='10000000-0000-0000-0000-000000000002'::uuid, 'successful claim remains idempotent after expiry');
RESET ROLE;
UPDATE auth.users SET email='renamed-parent1@p1.test' WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE auth.users SET email='parent1@p1.test' WHERE id='20000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_denied($$SELECT public.accept_parent_invite('40000000-0000-0000-0000-000000000001')$$, 'accepted invitation cannot be reassigned when its recipient email changes owner');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.player_parent_links), 'recycled email creates no extra child link');

-- Anonymous callers must not inherit explicit grants left by older migrations.
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.link_parent_to_players_by_email(text)', 'EXECUTE'), 'anonymous legacy RPC execute revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.create_parent_invite(text)', 'EXECUTE'), 'anonymous create RPC execute revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.accept_parent_invite(uuid)', 'EXECUTE'), 'anonymous acceptance revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.resend_parent_invite(uuid)', 'EXECUTE'), 'anonymous resend revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_my_pending_parent_invite()', 'EXECUTE'), 'anonymous tokenless discovery revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_my_pending_parent_invites()', 'EXECUTE'), 'anonymous multi-child discovery revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_parent_invite_by_token(uuid)', 'EXECUTE'), 'anonymous invite details revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_parent_pending_invites_for_current_user()', 'EXECUTE'), 'anonymous legacy discovery revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_player_invites_for_current_user()', 'EXECUTE'), 'anonymous issuer listing revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.provision_my_profile(jsonb)', 'EXECUTE'), 'anonymous provisioning revoked');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.expect_denied($$SELECT public.link_parent_to_players_by_email('parent1@p1.test')$$, 'anonymous request cannot execute claim');

ROLLBACK;

-- @trak-suite mode=--roster-invite-review in-all=true
-- TRAK-11 phase 3 (J2/J3, docs/superpowers/specs/2026-09-25-consent-first-admission-design.md):
-- who send-roster-invites may email for a roster place. The operator invites
-- the guardians who haven't signed up (and an adult child, who needs no
-- consent). A guardian may have the child invited only once they themselves
-- have an active consent for that child, and only until the child has joined.
-- Synthetic fixtures only; run after real migrations in a disposable database.
-- The whole suite is one transaction and rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing roster invite fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ri(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98a00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ri_results (description text, passed boolean, detail text);

CREATE FUNCTION pg_temp.ri_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.ri_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Expects a refusal with 42501 and this exact reason.
CREATE FUNCTION pg_temp.ri_refused(statement text, reason text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '42501' OR SQLERRM <> reason THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.ri_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.ri_targets(p_child uuid, p_guardian uuid) RETURNS text LANGUAGE sql AS $test$
  SELECT coalesce(string_agg(kind || ':' || email || ':' || coalesce(first_name, '') || ':' || coalesce(academy, ''), ' ' ORDER BY kind, email), '')
  FROM public.roster_invite_targets(p_child, p_guardian);
$test$;

CREATE FUNCTION pg_temp.ri_consent(p_child uuid, p_guardian uuid, p_withdrawn boolean DEFAULT false) RETURNS void LANGUAGE sql AS $test$
  INSERT INTO public.parental_consents (roster_child_id, parent_user_id, relationship_declared, verification_method,
    purposes, notice_version, consent_text, threshold_age, player_age_at_consent, withdrawn_at)
  VALUES (p_child, p_guardian, 'parent', 'email_confirmed', '{"coaching_records":true}', 'fixture',
    'Synthetic roster consent.', 18, 13, CASE WHEN p_withdrawn THEN now() END);
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- 70 Ana (13): guardians 20 (claimed, consents), 22 (claimed, no consent) and unclaimed g2@.
-- 71 Cleo (adult): guardian 21 (claimed, no consent).
-- 72 Dan (13): guardian 20 (claimed, consent withdrawn), 22 (claimed, no consent).
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.ri(1),  'admin@roster-invite.test', now()),
  (pg_temp.ri(2),  'coach@roster-invite.test', now()),
  (pg_temp.ri(10), 'ana@roster-invite.test',   now()),
  (pg_temp.ri(20), 'g1@roster-invite.test',    now()),
  (pg_temp.ri(21), 'g3@roster-invite.test',    now()),
  (pg_temp.ri(22), 'g4@roster-invite.test',    now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.ri(1), 'club',  'RI Admin'),
  (pg_temp.ri(2), 'coach', 'RI Coach');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.ri(50), pg_temp.ri(1), 'Invite FC', 'RI-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.ri(2), pg_temp.ri(50));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.ri(60), pg_temp.ri(2), 'Ana Maria Synthetic', 'U14'),
  (pg_temp.ri(61), pg_temp.ri(2), 'Cleo Synthetic',      'Senior'),
  (pg_temp.ri(62), pg_temp.ri(2), 'Dan Synthetic',       'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.ri(70), pg_temp.ri(50), pg_temp.ri(60), '2013-03-04', 'ana@roster-invite.test',  'fixture'),
  (pg_temp.ri(71), pg_temp.ri(50), pg_temp.ri(61), '2000-01-01', 'cleo@roster-invite.test', 'fixture'),
  (pg_temp.ri(72), pg_temp.ri(50), pg_temp.ri(62), '2013-07-08', 'dan@roster-invite.test',  'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, parent_user_id, loaded_by) VALUES
  (pg_temp.ri(70), 'g1@roster-invite.test', pg_temp.ri(20), 'fixture'),
  (pg_temp.ri(70), 'g2@roster-invite.test', NULL,           'fixture'),
  (pg_temp.ri(70), 'g4@roster-invite.test', pg_temp.ri(22), 'fixture'),
  (pg_temp.ri(71), 'g3@roster-invite.test', pg_temp.ri(21), 'fixture'),
  (pg_temp.ri(72), 'g1@roster-invite.test', pg_temp.ri(20), 'fixture'),
  (pg_temp.ri(72), 'g4@roster-invite.test', pg_temp.ri(22), 'fixture');
SELECT pg_temp.ri_consent(pg_temp.ri(70), pg_temp.ri(20));
SELECT pg_temp.ri_consent(pg_temp.ri(72), pg_temp.ri(20), true);

-- ── 1. The operator entry ──────────────────────────────────────────────────
SELECT pg_temp.ri_check(pg_temp.ri_targets(pg_temp.ri(70), NULL) = 'guardian:g2@roster-invite.test:Ana:Invite FC',
  '1 J2 the operator invites the guardians who have not signed up yet, with the child''s first name and academy',
  pg_temp.ri_targets(pg_temp.ri(70), NULL));
SELECT pg_temp.ri_check(pg_temp.ri_targets(pg_temp.ri(71), NULL) = 'child:cleo@roster-invite.test:Cleo:Invite FC',
  '1 J3 an adult child is invited at admission, needing no consent',
  pg_temp.ri_targets(pg_temp.ri(71), NULL));

-- ── 2. The guardian entry ──────────────────────────────────────────────────
SELECT pg_temp.ri_check(pg_temp.ri_targets(pg_temp.ri(70), pg_temp.ri(20)) = 'child:ana@roster-invite.test:Ana:Invite FC',
  '2 J3 a claimed guardian with their own active consent has the child invited',
  pg_temp.ri_targets(pg_temp.ri(70), pg_temp.ri(20)));
SELECT pg_temp.ri_refused(format('SELECT * FROM public.roster_invite_targets(%L, %L)', pg_temp.ri(70), pg_temp.ri(21)),
  'not_guardian', '2 G2 a guardian of another child cannot have this child invited');
SELECT pg_temp.ri_refused(format('SELECT * FROM public.roster_invite_targets(%L, %L)', pg_temp.ri(72), pg_temp.ri(22)),
  'consent_required', '2 G1 a guardian without an active consent cannot have the child invited');
SELECT pg_temp.ri_refused(format('SELECT * FROM public.roster_invite_targets(%L, %L)', pg_temp.ri(72), pg_temp.ri(20)),
  'consent_required', '2 G6 a withdrawn consent does not count');
SELECT pg_temp.ri_refused(format('SELECT * FROM public.roster_invite_targets(%L, %L)', pg_temp.ri(70), pg_temp.ri(22)),
  'consent_required', '2 G1 another guardian''s consent is theirs: a guardian who hasn''t consented cannot send it');

-- ── 3. Once the child has joined, there is nobody to invite ────────────────
UPDATE public.roster_children SET player_user_id = pg_temp.ri(10) WHERE id = pg_temp.ri(70);
SELECT pg_temp.ri_check(pg_temp.ri_targets(pg_temp.ri(70), pg_temp.ri(20)) = '',
  '3 J3 a child who already has an account is not invited again');

-- ── 4. Recording a delivery ────────────────────────────────────────────────
SELECT public.mark_roster_invite_sent(pg_temp.ri(70), 'guardian', 'g2@roster-invite.test');
SELECT public.mark_roster_invite_sent(pg_temp.ri(70), 'guardian', 'g2@roster-invite.test');
SELECT public.mark_roster_invite_sent(pg_temp.ri(71), 'child', 'cleo@roster-invite.test');
SELECT pg_temp.ri_check(
  (SELECT invite_count = 2 AND invited_at IS NOT NULL FROM public.roster_guardians
   WHERE roster_child_id = pg_temp.ri(70) AND email = 'g2@roster-invite.test')
  AND (SELECT invite_count = 0 AND invited_at IS NULL FROM public.roster_guardians
       WHERE roster_child_id = pg_temp.ri(70) AND email = 'g1@roster-invite.test')
  AND (SELECT invite_count = 1 AND invited_at IS NOT NULL FROM public.roster_children WHERE id = pg_temp.ri(71)),
  '4 J2 each delivery is counted on the row it went to, and only that row');

-- ── 4b. TRAK-84: a child without an email is never a target ───────────────
-- Their guardian creates the login instead. Counted as rows: ri_targets builds
-- text, and a NULL address would drop out of it silently.
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.ri(63), pg_temp.ri(2), 'Eve Synthetic', 'U11'),
  (pg_temp.ri(64), pg_temp.ri(2), 'Finn Synthetic', 'Senior');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.ri(73), pg_temp.ri(50), pg_temp.ri(63), '2016-02-03', NULL, 'fixture'),
  (pg_temp.ri(74), pg_temp.ri(50), pg_temp.ri(64), '2000-02-03', NULL, 'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, parent_user_id, loaded_by) VALUES
  (pg_temp.ri(73), 'g1@roster-invite.test', pg_temp.ri(20), 'fixture'),
  (pg_temp.ri(74), 'g5@roster-invite.test', NULL, 'fixture');
SELECT pg_temp.ri_consent(pg_temp.ri(73), pg_temp.ri(20));
SELECT pg_temp.ri_check(
  (SELECT count(*) FROM public.roster_invite_targets(pg_temp.ri(73), pg_temp.ri(20))) = 0,
  '4b J3 a consented guardian asking for an email-less child gets no invitation target (they create the login)');
SELECT pg_temp.ri_check(
  (SELECT count(*) FILTER (WHERE kind = 'child') = 0 AND count(*) FILTER (WHERE kind = 'guardian') = 1
   FROM public.roster_invite_targets(pg_temp.ri(74), NULL)),
  '4b J2 the operator still invites the guardian of an email-less adult, and never the child');

-- ── 4c. TRAK-91: only_uninvited, for load-roster --reinvite ────────────────
-- 75 Gus (13): two unsigned guardians, g6 already invited, g7 never.
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.ri(65), pg_temp.ri(2), 'Gus Synthetic', 'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.ri(75), pg_temp.ri(50), pg_temp.ri(65), '2013-09-10', 'gus@roster-invite.test', 'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, parent_user_id, invited_at, invite_count, loaded_by) VALUES
  (pg_temp.ri(75), 'g6@roster-invite.test', NULL, now(), 1, 'fixture'),
  (pg_temp.ri(75), 'g7@roster-invite.test', NULL, NULL,  0, 'fixture');
SELECT pg_temp.ri_check(
  (SELECT string_agg(email, ' ' ORDER BY email) FROM public.roster_invite_targets(pg_temp.ri(75), NULL, true)) = 'g7@roster-invite.test',
  '4c TRAK-91 with only_uninvited, a mixed family re-sends only to the guardian never invited');
SELECT pg_temp.ri_check(
  (SELECT string_agg(email, ' ' ORDER BY email) FROM public.roster_invite_targets(pg_temp.ri(75), NULL)) = 'g6@roster-invite.test g7@roster-invite.test',
  '4c CONTROL the default call is unchanged: every guardian who has not signed up, so an expired link can still be resent');
SELECT pg_temp.ri_check(
  (SELECT count(*) FROM public.roster_invite_targets(pg_temp.ri(71), NULL, true)) = 0
  AND pg_temp.ri_targets(pg_temp.ri(71), NULL) = 'child:cleo@roster-invite.test:Cleo:Invite FC',
  '4c TRAK-91 an adult child already invited is left out with only_uninvited, and still offered by default');

-- ── 5. Only the edge function's service role can call either ───────────────
SELECT pg_temp.ri_check(
  NOT has_function_privilege('authenticated', 'public.roster_invite_targets(uuid, uuid, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.roster_invite_targets(uuid, uuid, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.mark_roster_invite_sent(uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.mark_roster_invite_sent(uuid, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.roster_invite_targets(uuid, uuid, boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.mark_roster_invite_sent(uuid, text, text)', 'EXECUTE'),
  '5 no app account can read roster addresses or change delivery counts');
SELECT pg_temp.ri_check(to_regprocedure('public.roster_invite_targets(uuid, uuid)') IS NULL,
  '5 TRAK-91 the old two-argument version is gone, so no caller can skip the new grants');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.ri_results;
  IF total <> 16 THEN
    RAISE EXCEPTION 'Roster invite targets: % assertions ran; expected exactly 16', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Roster invite targets: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.ri_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Roster invite targets: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

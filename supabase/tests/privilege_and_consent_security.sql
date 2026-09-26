-- @trak-suite mode=--privilege-consent-review in-all=true
-- Synthetic fixtures only. Run after real migrations in a disposable database.
-- Covers 20260919120001 (table privileges), 20260919120002 (consent purpose)
-- 20260919120003 (stale-consent report), and internal helper/RLS isolation.
-- Every denial assertion has a
-- positive control beside it, so "refused" is distinguishable from "didn't run".
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing privilege/consent fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.pc_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('95000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE pc_results (description text, passed boolean, detail text);
GRANT INSERT ON pc_results TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.pc_assert(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.pc_results VALUES (description, ok IS TRUE, NULL);
END;
$test$;
-- Denied means insufficient_privilege specifically. Any other outcome — including
-- success — is recorded with its SQLSTATE so a false pass cannot hide as a pass.
CREATE FUNCTION pg_temp.pc_expect_denied(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE denied boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION USING ERRCODE = 'ZV001', MESSAGE = 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN denied := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.pc_results VALUES (description, denied, failure);
END;
$test$;
-- Expect a specific SQLSTATE (e.g. a RAISE EXCEPTION or a CHECK violation).
CREATE FUNCTION pg_temp.pc_expect_sqlstate(statement text, sqlstate text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE matched boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE = sqlstate THEN matched := true;
      ELSE failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.pc_results VALUES (description, matched, failure);
END;
$test$;
CREATE FUNCTION pg_temp.pc_expect_ok(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.pc_results VALUES (description, failure IS NULL, failure);
END;
$test$;
CREATE FUNCTION pg_temp.pc_as(role_name text, user_number integer) RETURNS void
LANGUAGE plpgsql AS $test$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', role_name, 'sub', pg_temp.pc_id(user_number))::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.pc_reset() RETURNS void
LANGUAGE plpgsql AS $test$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);  -- RESET ROLE alone leaves auth.uid() set
END;
$test$;

-- ── Fixtures ────────────────────────────────────────────────
-- 1 coach · 2 minor with consent · 3 minor never invited, 40 days old
-- 4 minor invited 5 days ago · 5 parent (linked to 2, 3, 4)
-- 6 minor with two old invites · 7 minor never invited, 5 days old (still reported)
-- 8 adult player. All identities are synthetic.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.pc_id(n), 'pc-' || n || '@test.invalid', now() FROM generate_series(1, 8) n;
INSERT INTO public.profiles (user_id, role, full_name, created_at) VALUES
  (pg_temp.pc_id(1), 'coach',  'Fixture Coach',        now() - interval '100 days'),
  (pg_temp.pc_id(2), 'player', 'Consented Minor',      now() - interval '100 days'),
  (pg_temp.pc_id(3), 'player', 'Never Invited Old',    now() - interval '40 days'),
  (pg_temp.pc_id(4), 'player', 'Recently Invited',     now() - interval '100 days'),
  (pg_temp.pc_id(5), 'parent', 'Fixture Parent',       now() - interval '100 days'),
  (pg_temp.pc_id(6), 'player', 'Twice Invited',        now() - interval '100 days'),
  (pg_temp.pc_id(7), 'player', 'Never Invited New',    now() - interval '5 days'),
  (pg_temp.pc_id(8), 'player', 'Adult Player',         now() - interval '100 days');
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.pc_id(101), pg_temp.pc_id(1), 'Fixture Academy', 'PC-FIXTURE');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.pc_id(1), pg_temp.pc_id(101));
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.pc_id(2), current_date - interval '10 years'),
  (pg_temp.pc_id(3), current_date - interval '10 years'),
  (pg_temp.pc_id(4), current_date - interval '10 years'),
  (pg_temp.pc_id(6), current_date - interval '10 years'),
  (pg_temp.pc_id(7), current_date - interval '10 years'),
  (pg_temp.pc_id(8), '2000-01-01');
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, organization_id) VALUES
  (pg_temp.pc_id(201), pg_temp.pc_id(1), 'Consented Minor', pg_temp.pc_id(2), pg_temp.pc_id(101)),
  (pg_temp.pc_id(203), pg_temp.pc_id(1), 'Never Invited Old', pg_temp.pc_id(3), pg_temp.pc_id(101));
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES
  (pg_temp.pc_id(2), pg_temp.pc_id(5)), (pg_temp.pc_id(3), pg_temp.pc_id(5)), (pg_temp.pc_id(4), pg_temp.pc_id(5));
INSERT INTO public.parent_invites (player_user_id, parent_email, created_at) VALUES
  (pg_temp.pc_id(4), 'pc-5@test.invalid', now() - interval '5 days'),
  (pg_temp.pc_id(6), 'pc-5@test.invalid', now() - interval '45 days'),
  (pg_temp.pc_id(6), 'pc-5@test.invalid', now() - interval '35 days');
-- Minor 2 already consented, all purposes true (the shape production holds today).
INSERT INTO public.parental_consents
  (player_user_id, parent_user_id, relationship_declared, verification_method, purposes,
   notice_version, consent_text, threshold_age, player_age_at_consent)
VALUES (pg_temp.pc_id(2), pg_temp.pc_id(5), 'parent', 'email_confirmed',
  '{"coaching_records": true, "recognition": true, "parent_visibility": true}',
  'v1', 'fixture wording', 15, 10);


-- ════════════════════════════════════════════════════════════
-- A. Table privileges (20260919120001)
-- ════════════════════════════════════════════════════════════

-- A0. Positive control for the harness: a table that IS granted TRUNCATE can be
-- truncated by authenticated. This proves pc_expect_denied's "denied" verdict
-- on app tables is a real refusal and not a statement that never executed.
CREATE TABLE public.pc_truncate_control (id int);
INSERT INTO public.pc_truncate_control VALUES (1), (2);
-- Born closed: default privileges no longer grant the app roles anything.
SELECT pg_temp.pc_assert(
  NOT has_table_privilege('anon', 'public.pc_truncate_control', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.pc_truncate_control', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'A0: a newly created table grants anon/authenticated nothing (default privileges closed)');
GRANT TRUNCATE ON public.pc_truncate_control TO authenticated;
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_expect_ok('TRUNCATE public.pc_truncate_control', 'A0: positive control — TRUNCATE succeeds where explicitly granted');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_assert((SELECT count(*) = 0 FROM public.pc_truncate_control), 'A0: positive control actually emptied the table');
DROP TABLE public.pc_truncate_control;

-- A1. Every app table: anon can do nothing; authenticated cannot TRUNCATE.
DO $test$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    PERFORM pg_temp.pc_as('anon', 1);
    PERFORM pg_temp.pc_expect_denied(format('SELECT 1 FROM %s LIMIT 1', t.rel), 'A1 anon: SELECT denied on ' || t.relname);
    PERFORM pg_temp.pc_expect_denied(format('TRUNCATE %s', t.rel), 'A1 anon: TRUNCATE denied on ' || t.relname);
    PERFORM pg_temp.pc_reset();
    PERFORM pg_temp.pc_as('authenticated', 1);
    PERFORM pg_temp.pc_expect_denied(format('TRUNCATE %s', t.rel), 'A1 authenticated: TRUNCATE denied on ' || t.relname);
    PERFORM pg_temp.pc_assert(
      NOT has_table_privilege('authenticated', t.rel, 'TRUNCATE,REFERENCES,TRIGGER'),
      'A1 authenticated: no TRUNCATE/REFERENCES/TRIGGER privilege on ' || t.relname);
    PERFORM pg_temp.pc_reset();
  END LOOP;
END;
$test$;

-- A1b. The invariant, asserted for every table that exists rather than for a
-- list written today: authenticated's DML grants match what its policies back,
-- in both directions. A table added by a migration with an earlier timestamp
-- whose PR merges later is exactly the case a list misses.
DO $test$
DECLARE t record; expected text[]; actual text[];
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    SELECT coalesce(array_agg(DISTINCT operation ORDER BY operation), '{}')
    INTO expected
    FROM (
      SELECT unnest(CASE WHEN p.cmd IN ('ALL', '*')
                         THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
                         ELSE ARRAY[p.cmd] END) AS operation
      FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.relname
        AND p.roles && ARRAY['authenticated', 'public']::name[]
        -- 20260919193112: a deny-only policy states a prohibition and must
        -- not produce a grant, or it becomes the single barrier itself.
        AND coalesce(p.qual, 'true')       NOT IN ('false', '(false)')
        AND coalesce(p.with_check, 'true') NOT IN ('false', '(false)')
    ) e
    WHERE operation IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

    SELECT coalesce(array_agg(op ORDER BY op), '{}') INTO actual
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) op
    WHERE has_table_privilege('authenticated', t.rel, op);

    PERFORM pg_temp.pc_assert(expected = actual,
      format('A1b: %s grants match its policies (policies %s, grants %s)', t.relname, expected, actual));
  END LOOP;
END;
$test$;

-- A1c. Append-only tables: the deny policy must not be the only barrier.
-- A child's assessment history should need two mistakes to become deletable,
-- not one. Named explicitly so a silent no-op cannot pass as a pass.
DO $test$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coach_assessment_notes', 'coach_assessments', 'recognition_awards'] LOOP
    PERFORM pg_temp.pc_assert(
      NOT has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'),
      format('A1c: %s does not grant DELETE behind its no-deletion policy', t));
    PERFORM pg_temp.pc_assert(
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                AND cmd = 'DELETE' AND coalesce(qual, '') IN ('false', '(false)')),
      format('A1c: %s still carries its no-deletion policy (both barriers, not one)', t));
  END LOOP;
  -- Retained attendance keeps DELETE; parked calendar authoring has both
  -- privilege and restrictive-policy barriers, while its history stays readable.
  FOREACH t IN ARRAY ARRAY['session_attendance', 'coach_calendar_events'] LOOP
    IF t = 'coach_calendar_events' THEN
      PERFORM pg_temp.pc_assert(
        NOT has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'),
        format('A1c parked control: %s no longer grants DELETE', t));
      PERFORM pg_temp.pc_assert(
        EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
          AND cmd = 'DELETE' AND permissive = 'RESTRICTIVE'
          AND coalesce(qual, '') IN ('false', '(false)')),
        format('A1c parked control: %s retains its restrictive deletion barrier', t));
      PERFORM pg_temp.pc_assert(
        has_table_privilege('authenticated', ('public.' || t)::regclass, 'SELECT'),
        format('A1c parked control: %s keeps historical SELECT', t));
    ELSE
      PERFORM pg_temp.pc_assert(
        has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE'),
        format('A1c positive control: %s keeps DELETE, a real journey uses it', t));
    END IF;
  END LOOP;
END;
$test$;

-- A2. Journeys that must survive: the grants that remain are the ones policies use.
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_assert((SELECT full_name = 'Fixture Coach' FROM public.profiles WHERE user_id = pg_temp.pc_id(1)), 'A2 coach: reads own profile');
SELECT pg_temp.pc_expect_ok(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, organization_id) VALUES (%L, %L, %L)',
  pg_temp.pc_id(1), pg_temp.pc_id(201), pg_temp.pc_id(101)), 'A2 coach: inserts an assessment for a consented child');
SELECT pg_temp.pc_expect_ok(format(
  'INSERT INTO public.telemetry_events (user_id, role, event_type, metadata) VALUES (%L, %L, %L, %L)',
  pg_temp.pc_id(1), 'coach', 'assessment_submitted', '{"duration_ms":1}'), 'A2 coach: appends own telemetry');
SELECT pg_temp.pc_expect_denied('SELECT 1 FROM public.telemetry_events LIMIT 1', 'A2 coach: cannot read telemetry (no SELECT grant, no policy)');
SELECT pg_temp.pc_expect_denied(format('DELETE FROM public.profiles WHERE user_id = %L', pg_temp.pc_id(1)), 'A2 coach: cannot DELETE profiles (no grant, no policy)');
SELECT pg_temp.pc_expect_denied(format(
  'INSERT INTO public.parental_consents (player_user_id, parent_user_id, relationship_declared, verification_method, purposes, notice_version, consent_text, threshold_age, player_age_at_consent) VALUES (%L, %L, %L, %L, %L, %L, %L, 15, 10)',
  pg_temp.pc_id(3), pg_temp.pc_id(1), 'parent', 'email_confirmed', '{"coaching_records":true}', 'v1', 'x'),
  'A2 coach: cannot write parental_consents directly (RPC only)');
SELECT pg_temp.pc_expect_denied('SELECT 1 FROM public.parent_invites LIMIT 1', 'A2 coach: no direct read of parent_invites');
SELECT pg_temp.pc_expect_denied('SELECT 1 FROM public.pilot_config LIMIT 1', 'A2 coach: no direct read of pilot_config');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_as('authenticated', 5);
SELECT pg_temp.pc_assert((SELECT count(*) = 1 FROM public.parental_consents WHERE parent_user_id = pg_temp.pc_id(5)), 'A2 parent: reads own consent rows');
SELECT pg_temp.pc_reset();


-- ════════════════════════════════════════════════════════════
-- B. Consent must grant coaching_records (20260919120002)
-- ════════════════════════════════════════════════════════════

-- B0. Positive control: a full grant through the RPC is accepted and satisfies the gate.
SELECT pg_temp.pc_as('authenticated', 5);
SELECT pg_temp.pc_assert(EXISTS (SELECT 1 FROM public.get_children_awaiting_consent() WHERE player_user_id = pg_temp.pc_id(3)),
  'B0: minor 3 requires consent before any grant');
SELECT pg_temp.pc_expect_ok(format(
  'SELECT public.record_parental_consent(%L, %L, %L::jsonb, %L, %L)',
  pg_temp.pc_id(3), 'parent', '{"coaching_records": true, "recognition": false, "parent_visibility": false}', 'v1', 'fixture wording'),
  'B0: positive control — RPC accepts a grant with coaching_records true');
SELECT pg_temp.pc_assert(NOT EXISTS (SELECT 1 FROM public.get_children_awaiting_consent() WHERE player_user_id = pg_temp.pc_id(3)),
  'B0: the linked child leaves the pending list after a real grant');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_assert(public.player_has_parental_consent(pg_temp.pc_id(3)), 'B0: predicate is true after a real grant');
SELECT pg_temp.pc_assert(NOT public.player_consent_required(pg_temp.pc_id(3)), 'B0: gate opens after a real grant');
SELECT pg_temp.pc_as('authenticated', 5);

-- B1. The RPC refuses a grant that declines coaching_records, or grants nothing.
SELECT pg_temp.pc_expect_sqlstate(format(
  'SELECT public.record_parental_consent(%L, %L, %L::jsonb, %L, %L)',
  pg_temp.pc_id(4), 'parent', '{"coaching_records": false, "recognition": true, "parent_visibility": true}', 'v1', 'x'),
  'P0001', 'B1: RPC rejects coaching_records=false');
SELECT pg_temp.pc_expect_sqlstate(format(
  'SELECT public.record_parental_consent(%L, %L, %L::jsonb, %L, %L)',
  pg_temp.pc_id(4), 'parent', '{}', 'v1', 'x'),
  'P0001', 'B1: RPC rejects an empty purposes object');
SELECT pg_temp.pc_expect_sqlstate(format(
  'SELECT public.record_parental_consent(%L, %L, %L::jsonb, %L, %L)',
  pg_temp.pc_id(4), 'parent', '{"coaching_records": "yes"}', 'v1', 'x'),
  'P0001', 'B1: RPC rejects a non-boolean coaching_records');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_assert(NOT public.player_has_parental_consent(pg_temp.pc_id(4)), 'B1: minor 4 remains unconsented after every rejected grant');
SELECT pg_temp.pc_assert(public.player_consent_required(pg_temp.pc_id(4)), 'B1: gate stays closed for minor 4');

-- B2. The CHECK constraint refuses the row even when the RPC is bypassed.
SELECT pg_temp.pc_expect_sqlstate(format(
  'INSERT INTO public.parental_consents (player_user_id, parent_user_id, relationship_declared, verification_method, purposes, notice_version, consent_text, threshold_age, player_age_at_consent) VALUES (%L, %L, %L, %L, %L::jsonb, %L, %L, 15, 10)',
  pg_temp.pc_id(4), pg_temp.pc_id(5), 'parent', 'paper_form', '{"coaching_records": false}', 'v1', 'x'),
  '23514', 'B2: CHECK rejects a direct insert with coaching_records=false');
SELECT pg_temp.pc_expect_sqlstate(format(
  'UPDATE public.parental_consents SET purposes = %L::jsonb WHERE player_user_id = %L',
  '{"coaching_records": false}', pg_temp.pc_id(2)),
  '23514', 'B2: CHECK rejects downgrading an existing consent to coaching_records=false');

-- B3. The predicate reads purposes on its own — proven with the CHECK removed
-- inside this rolled-back transaction, so layer 1 is tested independently of layer 3.
ALTER TABLE public.parental_consents DROP CONSTRAINT parental_consents_coaching_records_granted;
INSERT INTO public.parental_consents
  (player_user_id, parent_user_id, relationship_declared, verification_method, purposes,
   notice_version, consent_text, threshold_age, player_age_at_consent)
VALUES (pg_temp.pc_id(4), pg_temp.pc_id(5), 'parent', 'paper_form',
  '{"coaching_records": false, "recognition": false, "parent_visibility": false}', 'v1', 'x', 15, 10);
SELECT pg_temp.pc_assert(NOT public.player_has_parental_consent(pg_temp.pc_id(4)), 'B3: an all-false consent row does not satisfy the predicate');
SELECT pg_temp.pc_assert(public.player_consent_required(pg_temp.pc_id(4)), 'B3: the gate stays closed on an all-false consent row');
-- Roster row is fixture data (a coach cannot link another account: enforce_self_linked_player).
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, organization_id)
VALUES (pg_temp.pc_id(204), pg_temp.pc_id(1), 'Recently Invited', pg_temp.pc_id(4), pg_temp.pc_id(101));
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_expect_sqlstate(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, organization_id) VALUES (%L, %L, %L)',
  pg_temp.pc_id(1), pg_temp.pc_id(204), pg_temp.pc_id(101)),
  '42501', 'B3: coach cannot assess a child whose only consent row grants nothing');
SELECT pg_temp.pc_reset();


-- ════════════════════════════════════════════════════════════
-- C. Stale-consent report sees the never-invited (20260919120003)
-- ════════════════════════════════════════════════════════════
-- Minor 3 was consented in B0. Withdraw it so the never-invited case is
-- exercised at 40 days; minor 7 is the same case at 5 days — both report,
-- because a missing invite is a provisioning defect, not a slow parent.
SELECT pg_temp.pc_as('authenticated', 5);
SELECT pg_temp.pc_assert(public.withdraw_parental_consent(pg_temp.pc_id(3)) = 1, 'C0: parent withdraws minor 3 consent (one row closed)');
SELECT pg_temp.pc_reset();
CREATE TEMP TABLE pc_stale AS SELECT * FROM public.stale_pending_consent;
SELECT pg_temp.pc_assert(
  (SELECT count(*) = 1 AND bool_and(invited_at IS NULL AND waiting_for IS NULL) FROM pc_stale WHERE player_user_id = pg_temp.pc_id(3)),
  'C1: never-invited minor created 40 days ago is reported, with null invite fields');
SELECT pg_temp.pc_assert(
  (SELECT count(*) = 1 AND bool_and(invited_at IS NULL) FROM pc_stale WHERE player_user_id = pg_temp.pc_id(7)),
  'C1: never-invited minor created 5 days ago is reported at once (provisioning defect, not staleness)');
SELECT pg_temp.pc_assert(NOT EXISTS (SELECT 1 FROM pc_stale WHERE player_user_id = pg_temp.pc_id(4)),
  'C2: minor invited 5 days ago is not stale');
SELECT pg_temp.pc_assert(
  (SELECT count(*) = 1 FROM pc_stale WHERE player_user_id = pg_temp.pc_id(6)),
  'C3: minor with two old invites appears exactly once');
SELECT pg_temp.pc_assert(
  (SELECT invited_at::date = (now() - interval '35 days')::date FROM pc_stale WHERE player_user_id = pg_temp.pc_id(6)),
  'C3: the row shown is the most recent invite');
SELECT pg_temp.pc_assert(NOT EXISTS (SELECT 1 FROM pc_stale WHERE player_user_id = pg_temp.pc_id(2)),
  'C4: consented minor is not reported');
SELECT pg_temp.pc_assert(NOT EXISTS (SELECT 1 FROM pc_stale WHERE player_user_id = pg_temp.pc_id(8)),
  'C4: adult is not reported');
-- Negative control for the original defect shape: the old predicate would hide minor 3.
SELECT pg_temp.pc_assert(
  NOT (COALESCE(NULL::timestamptz, now()) < now() - interval '30 days'),
  'C5: negative control — the pre-fix predicate evaluates false for a never-invited child');
-- Access unchanged: app roles still cannot read it; service_role can.
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_expect_denied('SELECT 1 FROM public.stale_pending_consent', 'C6 authenticated: report still denied');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_as('anon', 1);
SELECT pg_temp.pc_expect_denied('SELECT 1 FROM public.stale_pending_consent', 'C6 anon: report still denied');
SELECT pg_temp.pc_reset();
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.pc_expect_ok('SELECT 1 FROM public.stale_pending_consent', 'C6 service_role: report readable');
SELECT pg_temp.pc_reset();


-- D. Internal age/consent helpers are not public RPCs. Exercise real roles,
-- known and missing IDs: an ACL assertion alone would not prove denial.
DO $test$
DECLARE helper text; role_name text; target integer;
BEGIN
  FOREACH helper IN ARRAY ARRAY['player_age_years', 'player_has_parental_consent',
    'player_consent_required', 'squad_player_consent_required'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      -- Player 8 is unrelated to the target child/roster, with their own profile.
      PERFORM pg_temp.pc_as(role_name, 8);
      IF role_name = 'anon' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
      END IF;
      FOREACH target IN ARRAY ARRAY[
        CASE WHEN helper = 'squad_player_consent_required' THEN 201 ELSE 2 END, 999
      ] LOOP
        PERFORM pg_temp.pc_expect_denied(format('SELECT public.%I(%L::uuid)', helper, pg_temp.pc_id(target)),
          format('D1 %s: %s denies target %s', role_name, helper, target));
      END LOOP;
      PERFORM pg_temp.pc_reset();
    END LOOP;
    PERFORM pg_temp.pc_as('service_role', 8);
    PERFORM pg_temp.pc_expect_ok(format('SELECT public.%I(%L::uuid)', helper,
      pg_temp.pc_id(CASE WHEN helper = 'squad_player_consent_required' THEN 201 ELSE 2 END)),
      'D1 service_role: internal helper remains callable: ' || helper);
    PERFORM pg_temp.pc_reset();
  END LOOP;
END;
$test$;

-- Scoped application RPCs still execute their internal helpers as owner.
SELECT pg_temp.pc_as('authenticated', 2);
SELECT pg_temp.pc_assert(public.my_consent_status()->>'age' = '10'
  AND public.my_consent_status()->>'granted' = 'true', 'D2 player: own age and consent remain available');
SELECT pg_temp.pc_as('authenticated', 5);
SELECT pg_temp.pc_assert((SELECT count(*) = 2 AND bool_and(player_user_id IN (pg_temp.pc_id(3), pg_temp.pc_id(4)))
  FROM public.get_children_awaiting_consent()), 'D2 parent: only their linked unconsented children are returned');
SELECT pg_temp.pc_as('authenticated', 8);
SELECT pg_temp.pc_assert((SELECT count(*) = 0 FROM public.get_children_awaiting_consent()),
  'D2 unrelated player: cannot obtain another family through the scoped endpoint');
SELECT pg_temp.pc_assert((public.my_consent_status()->>'age')::integer > 18,
  'D2 unrelated player: scoped status describes the caller, not the target minor');
SELECT pg_temp.pc_reset();

-- Positive controls cover active assessment/manual-feedback and retained award reads.
-- G7 deliberately removes the deferred player_feedback policies and publisher;
-- retained rows must be inaccessible even while consent is active.
SELECT pg_temp.pc_as('authenticated', 1);
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, organization_id)
VALUES (pg_temp.pc_id(401), pg_temp.pc_id(1), pg_temp.pc_id(201), pg_temp.pc_id(101));
-- Active consent cannot reopen parked award authoring. Seed retained history
-- through the trusted role, then resume every application read/consent check.
SELECT pg_temp.pc_expect_denied(format(
  'INSERT INTO public.recognition_awards (coach_user_id, squad_player_id, organization_id, award_type) VALUES (%L,%L,%L,%L)',
  pg_temp.pc_id(1), pg_temp.pc_id(201), pg_temp.pc_id(101), 'player_of_the_week'),
  'D3 coach: active consent cannot reopen parked award insert');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_as('service_role', 1);
INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, organization_id, award_type)
VALUES (pg_temp.pc_id(402), pg_temp.pc_id(1), pg_temp.pc_id(201), pg_temp.pc_id(101), 'player_of_the_week');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_as('authenticated', 1);
INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at)
VALUES (pg_temp.pc_id(401), pg_temp.pc_id(1), 'PRIVATE-BRIDGE-SHARED-CANARY', now());
SELECT pg_temp.pc_expect_denied(format('SELECT public.publish_player_feedback(%L, %L)',
  pg_temp.pc_id(201), 'PRIVATE-BRIDGE-PLAYER-CANARY'),
  'D3 coach: consent cannot reopen the deferred publication RPC');
SELECT pg_temp.pc_reset();
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO public.player_feedback (squad_player_id, author_user_id, published_text)
VALUES (pg_temp.pc_id(201), pg_temp.pc_id(1), 'PRIVATE-BRIDGE-PLAYER-CANARY');
SELECT pg_temp.pc_assert((SELECT count(*) = 1 FROM public.player_feedback
  WHERE published_text = 'PRIVATE-BRIDGE-PLAYER-CANARY'),
  'D3 control: a retained deferred publication exists before read denials');
SELECT pg_temp.pc_reset();
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_assert((SELECT count(*) = 1 FROM public.coach_assessments WHERE id = pg_temp.pc_id(401))
  AND (SELECT count(*) = 1 FROM public.recognition_awards WHERE id = pg_temp.pc_id(402)),
  'D3 coach: consented assessment and retained award remain visible');
SELECT pg_temp.pc_as('authenticated', 2);
SELECT pg_temp.pc_assert((SELECT count(*) = 1 FROM public.coach_shared_feedback WHERE body = 'PRIVATE-BRIDGE-SHARED-CANARY'),
  'D3 player: published manual feedback remains usable');
SELECT pg_temp.pc_expect_denied('SELECT published_text FROM public.player_feedback',
  'D3 player: active consent does not expose retained deferred feedback');
SELECT pg_temp.pc_as('authenticated', 5);
SELECT pg_temp.pc_assert((SELECT count(*) = 1 FROM public.coach_assessments WHERE id = pg_temp.pc_id(401)),
  'D3 parent control: the parent reads the consented assessment (the bands)');
SELECT pg_temp.pc_assert((SELECT count(*) = 0 FROM public.coach_shared_feedback WHERE body = 'PRIVATE-BRIDGE-SHARED-CANARY'),
  'D3 parent (TRAK-15): published coach messages are not readable by the parent');
SELECT pg_temp.pc_as('authenticated', 8);
SELECT pg_temp.pc_assert((SELECT count(*) = 0 FROM public.coach_shared_feedback WHERE body = 'PRIVATE-BRIDGE-SHARED-CANARY'),
  'D3 unrelated player: manual feedback does not disclose the target');
SELECT pg_temp.pc_expect_denied('SELECT published_text FROM public.player_feedback',
  'D3 unrelated player: retained deferred feedback stays inaccessible');

SELECT pg_temp.pc_as('authenticated', 5);
SELECT public.withdraw_parental_consent(pg_temp.pc_id(2));
SELECT pg_temp.pc_assert((SELECT count(*) = 0 FROM public.coach_shared_feedback WHERE body = 'PRIVATE-BRIDGE-SHARED-CANARY'),
  'D4 parent: after withdrawal the parent still reads no shared feedback');
SELECT pg_temp.pc_as('authenticated', 2);
SELECT pg_temp.pc_assert(public.my_consent_status()->>'required' = 'true',
  'D4 player: scoped status reflects withdrawal');
SELECT pg_temp.pc_assert((SELECT count(*) = 0 FROM public.coach_shared_feedback WHERE body = 'PRIVATE-BRIDGE-SHARED-CANARY'),
  'D4 player: withdrawal hides previously visible manual feedback');
SELECT pg_temp.pc_expect_denied('SELECT published_text FROM public.player_feedback',
  'D4 player: retained deferred feedback stays inaccessible after withdrawal');
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_expect_denied(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, organization_id) VALUES (%L,%L,%L)',
  pg_temp.pc_id(1), pg_temp.pc_id(201), pg_temp.pc_id(101)), 'D4 coach: withdrawal blocks assessment insert');
SELECT pg_temp.pc_expect_denied(format(
  'INSERT INTO public.recognition_awards (coach_user_id, squad_player_id, organization_id, award_type) VALUES (%L,%L,%L,%L)',
  pg_temp.pc_id(1), pg_temp.pc_id(201), pg_temp.pc_id(101), 'player_of_the_week'), 'D4 coach: parked award insert remains blocked after withdrawal');
SELECT pg_temp.pc_reset();

-- E. The coach UI gets a scoped boolean, never an arbitrary-ID predicate.
-- Put scope checks before delegation: foreign, departed, missing and null IDs
-- must produce the same error without revealing which of those cases exists.
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES (pg_temp.pc_id(9), 'pc-9@test.invalid', now());
INSERT INTO public.profiles (user_id, role, full_name)
VALUES (pg_temp.pc_id(9), 'coach', 'Other Fixture Coach');
INSERT INTO public.coach_details (user_id, organization_id)
VALUES (pg_temp.pc_id(9), pg_temp.pc_id(101));
INSERT INTO public.squad_players (id, coach_user_id, player_name, status)
VALUES (pg_temp.pc_id(207), pg_temp.pc_id(1), 'Unlinked Fixture', 'active'),
       (pg_temp.pc_id(208), pg_temp.pc_id(1), 'Departed Fixture', 'coach_departed');

CREATE FUNCTION pg_temp.pc_expect_scope_denied(target uuid, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE denied boolean := false; failure text;
BEGIN
  BEGIN
    PERFORM public.coach_squad_player_consent_required(target);
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    denied := SQLSTATE = '42501' AND SQLERRM = 'Not authorized for this squad player';
    failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.pc_results VALUES (description, denied, CASE WHEN denied THEN NULL ELSE failure END);
END;
$test$;

DO $test$
DECLARE caller integer; target integer; role_name text;
BEGIN
  FOREACH caller IN ARRAY ARRAY[2, 5, 8, 9] LOOP
    PERFORM pg_temp.pc_as('authenticated', caller);
    FOREACH target IN ARRAY ARRAY[201, 999, NULL::integer] LOOP
      PERFORM pg_temp.pc_expect_scope_denied(CASE WHEN target IS NULL THEN NULL ELSE pg_temp.pc_id(target) END,
        format('E1 caller %s: scoped coach check denies target %s identically', caller, target));
    END LOOP;
    PERFORM pg_temp.pc_reset();
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon', 'service_role'] LOOP
    PERFORM pg_temp.pc_as(role_name, 1);
    FOREACH target IN ARRAY ARRAY[201, 999, NULL::integer] LOOP
      PERFORM pg_temp.pc_expect_denied(format('SELECT public.coach_squad_player_consent_required(%L::uuid)',
        CASE WHEN target IS NULL THEN NULL ELSE pg_temp.pc_id(target) END),
        format('E1 %s: scoped coach endpoint denies target %s', role_name, target));
    END LOOP;
    PERFORM pg_temp.pc_reset();
  END LOOP;
END;
$test$;
SELECT pg_temp.pc_as('authenticated', 1);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT pg_temp.pc_expect_scope_denied(pg_temp.pc_id(201), 'E1 authenticated without a subject: denied');
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_expect_scope_denied(pg_temp.pc_id(999), 'E1 owning coach: missing row denied identically');
SELECT pg_temp.pc_expect_scope_denied(NULL, 'E1 owning coach: null row denied identically');
SELECT pg_temp.pc_expect_scope_denied(pg_temp.pc_id(208), 'E1 owning coach: departed row denied identically');
SELECT pg_temp.pc_assert(public.coach_squad_player_consent_required(pg_temp.pc_id(201)) IS TRUE,
  'E2 owning coach: withdrawal requires consent');
SELECT pg_temp.pc_assert(public.coach_squad_player_consent_required(pg_temp.pc_id(207)) IS FALSE,
  'E2 owning coach: unlinked roster preserves the current gate');
SELECT pg_temp.pc_reset();

-- Re-grant through the actual parent RPC, then re-check through the new UI RPC.
SELECT pg_temp.pc_as('authenticated', 5);
SELECT public.record_parental_consent(pg_temp.pc_id(2), 'parent',
  '{"coaching_records": true, "recognition": false, "parent_visibility": true}'::jsonb, 'v1', 'fixture wording');
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_assert(public.coach_squad_player_consent_required(pg_temp.pc_id(201)) IS FALSE,
  'E2 owning coach: real parental approval opens the scoped check');
SELECT pg_temp.pc_reset();

-- Ownership is academy-aware, not just the coach UUID stored on the roster.
UPDATE public.coach_details SET organization_id = NULL WHERE user_id = pg_temp.pc_id(1);
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_expect_scope_denied(pg_temp.pc_id(201), 'E3 coach removed from academy: old roster denied');
SELECT pg_temp.pc_reset();
UPDATE public.coach_details SET organization_id = pg_temp.pc_id(101) WHERE user_id = pg_temp.pc_id(1);
-- Role loss must also close the endpoint even when ownership still matches.
UPDATE public.profiles SET role = 'player' WHERE user_id = pg_temp.pc_id(1);
SELECT pg_temp.pc_as('authenticated', 1);
SELECT pg_temp.pc_expect_scope_denied(pg_temp.pc_id(201), 'E3 former coach: owned roster denied after role loss');
SELECT pg_temp.pc_reset();

-- ── Verdict ─────────────────────────────────────────────────
DO $test$
DECLARE failed integer; details text;
BEGIN
  SELECT count(*), string_agg(description || coalesce(' [' || detail || ']', ''), E'\n' ORDER BY description)
  INTO failed, details FROM pg_temp.pc_results WHERE NOT passed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Privilege/consent security: % failing assertions', failed USING DETAIL = details;
  END IF;
END;
$test$;
SELECT count(*) AS privilege_consent_assertions FROM pg_temp.pc_results;
ROLLBACK;

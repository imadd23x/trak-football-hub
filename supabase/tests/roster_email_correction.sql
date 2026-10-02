-- @trak-suite mode=--roster-email-correction-review in-all=true
-- TRAK-16 (G5) / TRAK-11 (J3), docs/superpowers/specs/2026-10-01-roster-email-correction-design.md:
-- the operator corrects a wrong roster email, and the database records who,
-- when and why. A guardian is linked to a child by their confirmed email
-- matching the roster email, so once an address has been claimed it is never
-- moved; and after a correction the old address can no longer claim the child.
-- Synthetic fixtures only; run after real migrations in a disposable database.
-- The whole suite is one transaction and rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing roster email correction fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ec(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98b00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ec_results (description text, passed boolean, detail text);
GRANT INSERT ON ec_results TO authenticated, service_role;

CREATE FUNCTION pg_temp.ec_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.ec_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Expects a refusal whose message is exactly this reason.
CREATE FUNCTION pg_temp.ec_refused(statement text, reason text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> reason THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.ec_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.ec_fix(p_child uuid, p_kind text, p_old text, p_new text,
  p_by text DEFAULT 'Kostas (fixture)', p_reason text DEFAULT 'academy sent a typo') RETURNS text LANGUAGE sql AS $test$
  SELECT format('SELECT public.correct_roster_email(%L, %L, %L, %L, %L, %L)', p_child, p_kind, p_old, p_new, p_by, p_reason);
$test$;

CREATE FUNCTION pg_temp.ec_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.ec_sha(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $test$
  SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex');
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- 70 Ana (13): guardians g1 (not invited), g2 (invited once), g3 (claimed by 23), wrong@ (invited).
-- 71 Ben (13): signed up as 11.
-- 72 Cal (8): no child email (TRAK-84).
-- 73 Dee (13): another child, to collide with.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.ec(1),  'admin@email-fix.test',  now()),
  (pg_temp.ec(2),  'coach@email-fix.test',  now()),
  (pg_temp.ec(11), 'ben@email-fix.test',    now()),
  (pg_temp.ec(23), 'g3@email-fix.test',     now()),
  (pg_temp.ec(30), 'wrong@email-fix.test',  now()),
  (pg_temp.ec(31), 'right@email-fix.test',  now());
-- 30 and 31 are parent accounts, so the claim path really runs for them: it
-- only claims for a confirmed email with a parent profile.
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.ec(1),  'club',   'EC Admin'),
  (pg_temp.ec(2),  'coach',  'EC Coach'),
  (pg_temp.ec(30), 'parent', 'Wrong Adult Synthetic'),
  (pg_temp.ec(31), 'parent', 'Right Adult Synthetic');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.ec(50), pg_temp.ec(1), 'Fix FC', 'EC-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.ec(2), pg_temp.ec(50));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.ec(60), pg_temp.ec(2), 'Ana Synthetic', 'U14'),
  (pg_temp.ec(61), pg_temp.ec(2), 'Ben Synthetic', 'U14'),
  (pg_temp.ec(62), pg_temp.ec(2), 'Cal Synthetic', 'U9'),
  (pg_temp.ec(63), pg_temp.ec(2), 'Dee Synthetic', 'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, player_user_id, loaded_by) VALUES
  (pg_temp.ec(70), pg_temp.ec(50), pg_temp.ec(60), '2013-03-04', 'ana@email-fix.test', NULL,           'fixture'),
  (pg_temp.ec(71), pg_temp.ec(50), pg_temp.ec(61), '2013-05-06', 'ben@email-fix.test', pg_temp.ec(11), 'fixture'),
  (pg_temp.ec(72), pg_temp.ec(50), pg_temp.ec(62), '2018-01-02', NULL,                 NULL,           'fixture'),
  (pg_temp.ec(73), pg_temp.ec(50), pg_temp.ec(63), '2013-07-08', 'dee@email-fix.test', NULL,           'fixture');
INSERT INTO public.roster_guardians (id, roster_child_id, email, parent_user_id, loaded_by) VALUES
  (pg_temp.ec(80), pg_temp.ec(70), 'g1@email-fix.test',    NULL,           'fixture'),
  (pg_temp.ec(81), pg_temp.ec(70), 'g2@email-fix.test',    NULL,           'fixture'),
  (pg_temp.ec(82), pg_temp.ec(70), 'g3@email-fix.test',    pg_temp.ec(23), 'fixture'),
  (pg_temp.ec(83), pg_temp.ec(70), 'wrong@email-fix.test', NULL,           'fixture'),
  (pg_temp.ec(84), pg_temp.ec(72), 'g5@email-fix.test',    NULL,           'fixture');
SELECT public.mark_roster_invite_sent(pg_temp.ec(70), 'guardian', 'g2@email-fix.test');
SELECT public.mark_roster_invite_sent(pg_temp.ec(70), 'guardian', 'wrong@email-fix.test');
SELECT public.mark_roster_invite_sent(pg_temp.ec(70), 'child', 'ana@email-fix.test');

SET LOCAL ROLE service_role;

-- ── 1. Corrections that go through ─────────────────────────────────────────
SELECT public.correct_roster_email(pg_temp.ec(70), 'guardian', ' G1@Email-Fix.test ', ' G1.New@Email-Fix.test ',
  'Kostas (fixture)', 'academy sent a typo');
SELECT pg_temp.ec_check(
  (SELECT email = 'g1.new@email-fix.test' AND invited_at IS NULL FROM public.roster_guardians WHERE id = pg_temp.ec(80))
  AND (SELECT count(*) = 1 FROM public.roster_email_corrections c
       WHERE c.roster_guardian_id = pg_temp.ec(80) AND c.roster_child_id = pg_temp.ec(70) AND c.kind = 'guardian'
         AND c.corrected_by = 'Kostas (fixture)' AND c.reason = 'academy sent a typo' AND c.corrected_at IS NOT NULL
         AND NOT c.was_invited
         AND c.old_email_sha256 = pg_temp.ec_sha('g1@email-fix.test')
         AND c.new_email_sha256 = pg_temp.ec_sha('g1.new@email-fix.test')),
  '1 J3 a guardian address is corrected (normalised), with who, when, why and hashes of both addresses');

SELECT public.correct_roster_email(pg_temp.ec(70), 'guardian', 'g2@email-fix.test', 'g2.new@email-fix.test',
  'Kostas (fixture)', 'bounced');
SELECT pg_temp.ec_check(
  (SELECT email = 'g2.new@email-fix.test' AND invited_at IS NULL AND invite_count = 1
   FROM public.roster_guardians WHERE id = pg_temp.ec(81))
  AND (SELECT was_invited FROM public.roster_email_corrections WHERE roster_guardian_id = pg_temp.ec(81)),
  '1 J2 correcting an invited guardian clears invited_at for a re-invite, keeps the count and records that an invitation had gone');

SELECT public.correct_roster_email(pg_temp.ec(70), 'child', 'ana@email-fix.test', 'ana.new@email-fix.test',
  'Kostas (fixture)', 'school address');
SELECT pg_temp.ec_check(
  (SELECT child_email = 'ana.new@email-fix.test' AND invited_at IS NULL FROM public.roster_children WHERE id = pg_temp.ec(70))
  AND (SELECT kind = 'child' AND roster_guardian_id IS NULL AND was_invited
       FROM public.roster_email_corrections WHERE roster_child_id = pg_temp.ec(70) AND kind = 'child'),
  '1 J3 a child address is corrected the same way');

-- ── 2. G5: the old address can no longer claim the child ───────────────────
SELECT public.correct_roster_email(pg_temp.ec(70), 'guardian', 'wrong@email-fix.test', 'right@email-fix.test',
  'Kostas (fixture)', 'academy gave the wrong parent');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ec_as(pg_temp.ec(30));
SELECT public.claim_my_roster_guardian_rows();
SELECT pg_temp.ec_as(pg_temp.ec(31));
SELECT public.claim_my_roster_guardian_rows();
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.ec_check(
  NOT EXISTS (SELECT 1 FROM public.roster_guardians WHERE parent_user_id = pg_temp.ec(30)),
  '2 G5 an account at the corrected-away address claims nothing');
SELECT pg_temp.ec_check(
  (SELECT parent_user_id = pg_temp.ec(31) FROM public.roster_guardians WHERE id = pg_temp.ec(83)),
  '2 G5 CONTROL the account at the corrected address claims the child');

-- ── 3. Refusals ────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'g3@email-fix.test', 'g3.new@email-fix.test'),
  'already_claimed', '3 G5 a guardian who has signed up is never moved (an incident, not a correction)');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(71), 'child', 'ben@email-fix.test', 'ben.new@email-fix.test'),
  'already_claimed', '3 G5 a child who has signed up is never moved');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'nobody@email-fix.test', 'x@email-fix.test'),
  'not_on_roster', '3 the old address must be on that child: no guessing');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(99), 'guardian', 'g1.new@email-fix.test', 'x@email-fix.test'),
  'not_on_roster', '3 an unknown child is refused');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(72), 'child', 'cal@email-fix.test', 'cal@email-fix.test'),
  'no_child_email', '3 TRAK-84 a child with no email is out of scope');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'g1.new@email-fix.test', 'ana.new@email-fix.test'),
  'email_in_use', '3 a guardian address cannot become the child''s');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'g1.new@email-fix.test', 'g2.new@email-fix.test'),
  'email_in_use', '3 a guardian address cannot become another guardian''s on the same child');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'child', 'ana.new@email-fix.test', 'g1.new@email-fix.test'),
  'email_in_use', '3 a child address cannot become a guardian''s');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'child', 'ana.new@email-fix.test', 'dee@email-fix.test'),
  'email_in_use', '3 a child address cannot become another child''s');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'g1.new@email-fix.test', 'not an address'),
  'invalid_email', '3 a malformed address is refused');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'g1.new@email-fix.test', ' G1.NEW@email-fix.test'),
  'unchanged', '3 the same address after normalising is not a correction');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'g1.new@email-fix.test', 'x@email-fix.test', ' ', 'why'),
  'actor_and_reason_required', '3 the actor is required');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'guardian', 'g1.new@email-fix.test', 'x@email-fix.test', 'Kostas', ''),
  'actor_and_reason_required', '3 the reason is required');
SELECT pg_temp.ec_refused(pg_temp.ec_fix(pg_temp.ec(70), 'coach', 'g1.new@email-fix.test', 'x@email-fix.test'),
  'invalid_kind', '3 only guardian or child');
RESET ROLE;
SELECT pg_temp.ec_check(
  (SELECT count(*) = 4 FROM public.roster_email_corrections)
  AND (SELECT email = 'g1.new@email-fix.test' FROM public.roster_guardians WHERE id = pg_temp.ec(80)),
  '3 nothing refused above changed an address or wrote an audit row');

-- ── 4. Only the operator ───────────────────────────────────────────────────
SELECT pg_temp.ec_check(
  NOT has_function_privilege('authenticated', 'public.correct_roster_email(uuid, text, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.correct_roster_email(uuid, text, text, text, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.correct_roster_email(uuid, text, text, text, text, text)', 'EXECUTE'),
  '4 only the service role can correct an address');
SELECT pg_temp.ec_check(
  NOT has_table_privilege('authenticated', 'public.roster_email_corrections', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.roster_email_corrections', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.roster_email_corrections', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.roster_email_corrections'::regclass),
  '4 no app account can read or write the audit; RLS is on');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.ec_results;
  IF total <> 22 THEN
    RAISE EXCEPTION 'Roster email correction: % assertions ran; expected exactly 22', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Roster email correction: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.ec_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Roster email correction: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

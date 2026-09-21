-- @trak-suite mode=--pilot-views-review in-all=true
-- Synthetic fixtures only. Run after real migrations in a disposable database.
-- Assertions use actual database roles; even unexpected successful writes are
-- rolled back inside expect_denied so the vulnerable baseline can report all failures.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing operational-view fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.pilot_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('94000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE pilot_view_results (description text, passed boolean, detail text);
GRANT INSERT ON pilot_view_results TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.pilot_assert(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.pilot_view_results VALUES (description, ok IS TRUE, NULL);
END;
$test$;
CREATE FUNCTION pg_temp.pilot_expect_denied(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE denied boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    -- An exception also undoes an unexpectedly successful UPDATE/DELETE.
    RAISE EXCEPTION USING ERRCODE = 'ZV001', MESSAGE = 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN denied := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.pilot_view_results VALUES (description, denied, failure);
END;
$test$;
-- Unreadable means either RLS returns nothing or the grant is absent.
-- 20260919120001 removed SELECT on tables no policy reads, so the second
-- form is now the expected one for base telemetry.
CREATE FUNCTION pg_temp.pilot_unreadable(statement text) RETURNS boolean
LANGUAGE plpgsql AS $test$
DECLARE n bigint;
BEGIN
  BEGIN
    EXECUTE statement INTO n;
    RETURN n = 0;
  EXCEPTION WHEN insufficient_privilege THEN RETURN true;
  END;
END;
$test$;
CREATE TEMP TABLE pilot_views (name text PRIMARY KEY, expected jsonb);
INSERT INTO pilot_views (name) VALUES
  ('pilot_activation'), ('pilot_match_coverage'), ('pilot_assessment_rate'),
  ('pilot_time_to_assess'), ('pilot_rating_agreement'), ('pilot_rating_agreement_derived'),
  ('pilot_weekly_active'), ('pilot_retention'), ('pilot_safeguarding_checks'),
  ('pilot_scorecard'), ('squad_duplicate_candidates'), ('stale_pending_consent');
GRANT SELECT ON pilot_views TO anon, authenticated, service_role;

-- 1 report owner; 2 unrelated coach; 3 player; 4 parent; 5 club administrator;
-- 6 minor used only for the stale-consent report. All identities are synthetic.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.pilot_id(n), 'pilot-view-' || n || '@test.invalid', now()
FROM generate_series(1, 6) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.pilot_id(1), 'coach', 'Report Owner'),
  (pg_temp.pilot_id(2), 'coach', 'Unrelated Coach'),
  (pg_temp.pilot_id(3), 'player', 'Report Player'),
  (pg_temp.pilot_id(4), 'parent', 'Report Parent'),
  (pg_temp.pilot_id(5), 'club', 'Report Club Administrator'),
  (pg_temp.pilot_id(6), 'player', 'Pending Minor');
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.pilot_id(101), pg_temp.pilot_id(5), 'Synthetic Report Academy', 'REPORT-ONLY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.pilot_id(1), pg_temp.pilot_id(101)), (pg_temp.pilot_id(2), NULL);
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.pilot_id(3), '2000-01-01'), (pg_temp.pilot_id(6), current_date - interval '10 years');
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.pilot_id(201), pg_temp.pilot_id(1), 'Report Player', pg_temp.pilot_id(3)),
  (pg_temp.pilot_id(202), pg_temp.pilot_id(1), 'Report Player', NULL),
  (pg_temp.pilot_id(203), pg_temp.pilot_id(1), 'Pending Minor', pg_temp.pilot_id(6));
INSERT INTO public.parent_invites (player_user_id, parent_email, created_at)
VALUES (pg_temp.pilot_id(6), 'pilot-view-4@test.invalid', now() - interval '31 days');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES
  (pg_temp.pilot_id(3), pg_temp.pilot_id(4)), (pg_temp.pilot_id(6), pg_temp.pilot_id(4));
INSERT INTO public.matches (id, user_id, position, competition, venue, age_group, match_date, logged_by, logged_by_role)
VALUES (pg_temp.pilot_id(301), pg_temp.pilot_id(3), 'CM', 'Friendly', 'Home', 'Adult', current_date, pg_temp.pilot_id(3), 'player');
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, created_at)
VALUES (pg_temp.pilot_id(401), pg_temp.pilot_id(1), pg_temp.pilot_id(201), current_date + interval '6 hours');
-- Published, because 20260919160000 counts only published fixtures: a coach
-- cannot under-log a match nobody has been told about. Left unpublished this
-- fixture makes pilot_match_coverage empty, and the suite's own "nonempty owner
-- fixture" rule correctly refuses that.
INSERT INTO public.coach_calendar_events (coach_user_id, title, event_type, starts_at, published)
VALUES (pg_temp.pilot_id(1), 'Synthetic report fixture', 'match', current_date + interval '12 hours', true);
-- A DRAFT of a future fixture, deliberately unpublished. Before 20260919160000
-- this inflated the denominator and dragged reported coverage down the moment a
-- coach typed next month's fixtures — week 7 read 0% for this reason. Kept as a
-- decoy so the exclusion is falsifiable rather than assumed.
INSERT INTO public.coach_calendar_events (coach_user_id, title, event_type, starts_at, published)
VALUES (pg_temp.pilot_id(1), 'Unpublished draft fixture', 'match', current_date + interval '36 hours', false);
INSERT INTO public.telemetry_events (id, user_id, role, event_type, metadata) VALUES
  (pg_temp.pilot_id(501), pg_temp.pilot_id(1), 'coach', 'assessment_submitted', '{"duration_ms":30000,"players":1,"mode":"full"}'),
  (pg_temp.pilot_id(502), pg_temp.pilot_id(1), 'coach', 'blind_rating_captured', '{"position":"CM","gut_band":"good","computed_band":"steady"}');
UPDATE public.pilot_config SET starts_on = current_date, weeks = 8, org_id = pg_temp.pilot_id(101) WHERE id;

-- Snapshot full report contents as the owner, before changing the caller.
-- Every report must have a useful fixture: successful empty reads are insufficient.
DO $test$
DECLARE report record; contents jsonb;
BEGIN
  FOR report IN SELECT name FROM pg_temp.pilot_views LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text) FROM public.%I v', report.name) INTO contents;
    PERFORM pg_temp.pilot_assert(jsonb_array_length(contents) > 0, report.name || ': nonempty owner fixture');
    UPDATE pg_temp.pilot_views SET expected = contents WHERE name = report.name;
  END LOOP;
END;
$test$;
CREATE TEMP TABLE pilot_telemetry_before AS
SELECT * FROM public.telemetry_events;

-- All app identities use authenticated. An academy admin is not a service role.
DO $test$
DECLARE actor record; report record;
BEGIN
  FOR actor IN SELECT * FROM (VALUES
    ('anonymous', 'anon', NULL::integer), ('coach', 'authenticated', 2),
    ('player', 'authenticated', 3), ('parent', 'authenticated', 4),
    ('club administrator', 'authenticated', 5)
  ) AS actors(label, database_role, user_number) LOOP
    EXECUTE format('SET LOCAL ROLE %I', actor.database_role);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', actor.database_role, 'sub', pg_temp.pilot_id(actor.user_number))::text, true);
    PERFORM pg_temp.pilot_assert(current_user = actor.database_role AND auth.uid() IS NOT DISTINCT FROM pg_temp.pilot_id(actor.user_number), actor.label || ': actual caller identity');
    PERFORM pg_temp.pilot_assert(pg_temp.pilot_unreadable(format('SELECT count(*) FROM public.telemetry_events WHERE user_id = %L', pg_temp.pilot_id(1))), actor.label || ': base telemetry remains unreadable');
    FOR report IN SELECT name FROM pg_temp.pilot_views LOOP
      PERFORM pg_temp.pilot_expect_denied(format('SELECT * FROM public.%I', report.name), actor.label || ': SELECT ' || report.name);
      PERFORM pg_temp.pilot_assert(NOT has_table_privilege('public.' || report.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), actor.label || ': no table privilege ' || report.name);
      PERFORM pg_temp.pilot_assert(NOT has_any_column_privilege('public.' || report.name, 'SELECT,INSERT,UPDATE,REFERENCES'), actor.label || ': no column privilege ' || report.name);
    END LOOP;
    PERFORM pg_temp.pilot_expect_denied('SELECT who FROM public.pilot_activation', actor.label || ': column-only activation read denied');
    PERFORM pg_temp.pilot_expect_denied('SELECT parent_email FROM public.stale_pending_consent', actor.label || ': column-only parent email read denied');
    -- No CHECK OPTION exists on this view. In the old schema an INSERT can
    -- forge an event even when its default metadata keeps it out of the view.
    PERFORM pg_temp.pilot_expect_denied(format('INSERT INTO public.pilot_time_to_assess (coach_user_id, event_type, created_at) VALUES (%L, %L, now())', pg_temp.pilot_id(1), 'assessment_submitted'), actor.label || ': INSERT foreign telemetry via pilot_time_to_assess');
    -- These two views are automatically updatable: exercise actual mutations
    -- against another coach's row, not a WHERE false permission-only probe.
    FOR report IN SELECT name FROM pg_temp.pilot_views WHERE name IN ('pilot_time_to_assess', 'pilot_rating_agreement') LOOP
      PERFORM pg_temp.pilot_expect_denied(format('UPDATE public.%I SET created_at = %L WHERE coach_user_id = %L', report.name, '2001-01-01T00:00:00Z', pg_temp.pilot_id(1)), actor.label || ': UPDATE foreign telemetry via ' || report.name);
      PERFORM pg_temp.pilot_expect_denied(format('DELETE FROM public.%I WHERE coach_user_id = %L', report.name, pg_temp.pilot_id(1)), actor.label || ': DELETE foreign telemetry via ' || report.name);
    END LOOP;
    RESET ROLE;
  END LOOP;
END;
$test$;

-- Compare all base columns in both directions; denied writes must leave the
-- stored records unchanged, not just preserve the total number of rows.
SELECT pg_temp.pilot_assert(NOT EXISTS (
  (SELECT * FROM public.telemetry_events EXCEPT SELECT * FROM pilot_telemetry_before)
  UNION ALL
  (SELECT * FROM pilot_telemetry_before EXCEPT SELECT * FROM public.telemetry_events)
), 'denied telemetry writes preserve every base column');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $test$
DECLARE report record; contents jsonb;
BEGIN
  FOR report IN SELECT name, expected FROM pg_temp.pilot_views LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text) FROM public.%I v', report.name) INTO contents;
    PERFORM pg_temp.pilot_assert(contents = report.expected, report.name || ': service report matches full owner results');
    PERFORM pg_temp.pilot_assert(has_table_privilege('public.' || report.name, 'SELECT') AND NOT has_table_privilege('public.' || report.name, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), report.name || ': service view privileges are SELECT only');
  END LOOP;
  FOR report IN SELECT name FROM pg_temp.pilot_views WHERE name IN ('pilot_time_to_assess', 'pilot_rating_agreement') LOOP
    PERFORM pg_temp.pilot_expect_denied(format('UPDATE public.%I SET created_at = %L WHERE coach_user_id = %L', report.name, '2001-01-01T00:00:00Z', pg_temp.pilot_id(1)), 'service role: UPDATE report denied ' || report.name);
    PERFORM pg_temp.pilot_expect_denied(format('DELETE FROM public.%I WHERE coach_user_id = %L', report.name, pg_temp.pilot_id(1)), 'service role: DELETE report denied ' || report.name);
  END LOOP;
  PERFORM pg_temp.pilot_expect_denied(format('INSERT INTO public.pilot_time_to_assess (coach_user_id, event_type, created_at) VALUES (%L, %L, now())', pg_temp.pilot_id(1), 'assessment_submitted'), 'service role: INSERT report denied pilot_time_to_assess');
END;
$test$;
RESET ROLE;

-- Defense in depth is independently checked, alongside real privilege tests.
-- S3: the drafts exclusion, asserted rather than trusted. Two match fixtures
-- exist for this coach and exactly one is published, so a view that lost the
-- filter would count both. A bare "> 0" would not notice.
SELECT pg_temp.pilot_assert(
  (SELECT count(DISTINCT fixture_id) FROM public.pilot_match_coverage) = 1,
  'pilot_match_coverage: unpublished draft fixtures are not counted');

-- And the split reports the athlete number separately. The fixture's one match
-- is logged_by_role = 'player', so a split that collapsed back into the
-- combined figure would still show 100 here — the coach column is what
-- distinguishes them.
-- Guarded on existence, and the guard is the point rather than caution. The
-- --pilot-views-baseline mode replays only the migrations BEFORE the lockdown
-- so that this suite's security assertions are SEEN to fail; that is how we
-- know they can. An unguarded reference to a view introduced later aborts the
-- transaction on "relation does not exist" and the baseline stops proving
-- anything — a suite that cannot fail for the intended reason, which is the
-- failure mode this whole file exists to avoid.
DO $s3$
BEGIN
  IF to_regclass('public.pilot_match_coverage_by_logger') IS NOT NULL THEN
    PERFORM pg_temp.pilot_assert(
      (SELECT logged_player = 1 AND logged_coach = 0 AND logged_any = 1
         FROM public.pilot_match_coverage_by_logger LIMIT 1),
      'pilot_match_coverage_by_logger: player and coach logging are reported apart');
  END IF;
END;
$s3$;

SELECT pg_temp.pilot_assert(c.reloptions @> ARRAY['security_invoker=true'], v.name || ': invoker security')
FROM pg_temp.pilot_views v JOIN pg_class c ON c.oid = ('public.' || v.name)::regclass;
SELECT pg_temp.pilot_assert(p.proconfig @> ARRAY['search_path=pg_catalog'], p.proname || ': fixed built-in search path')
FROM pg_proc p WHERE p.oid IN ('public.band_ordinal(text)'::regprocedure, 'public.score_to_band(numeric)'::regprocedure);
SELECT pg_temp.pilot_assert(public.band_ordinal('GOOD') = 5 AND public.band_ordinal('unknown') IS NULL
  AND public.score_to_band(6.5) = 'steady' AND public.score_to_band(9) = 'exceptional', 'rating conversions retain behavior');

DO $test$
DECLARE failed integer; details text;
BEGIN
  SELECT count(*), string_agg(description || coalesce(' [' || detail || ']', ''), E'\n' ORDER BY description)
  INTO failed, details FROM pg_temp.pilot_view_results WHERE NOT passed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Operational-view security: % failing assertions', failed USING DETAIL = details;
  END IF;
END;
$test$;
SELECT count(*) AS pilot_view_assertions FROM pg_temp.pilot_view_results;
ROLLBACK;

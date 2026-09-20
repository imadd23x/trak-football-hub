-- @trak-suite mode=--pilot-scope-review in-all=true
-- ============================================================
-- The scorecard must count the pilot cohort, not the database
--
-- 20260901000005 exists because this already went wrong once, in its own
-- words: "activation read 3.2% against a squad that was ~54% claimed. The
-- views counted EVERY squad_players row and every parent_invite in the
-- database — demo academies, dev accounts, months of old seed data — so the
-- pilot cohort was a rounding error inside its own metric."
--
-- The fix works. I verified it before writing this: with org_id NULL the views
-- count both academies, and with org_id set they count one. What did not exist
-- was anything asserting it, so a regression to unscoped counting would be
-- invisible in exactly the way it was the first time — a plausible number,
-- quietly wrong, on the screen the pilot is judged by.
--
-- pilot_view_security.sql covers who may READ these views. This covers what
-- they COUNT. They are different questions and only the first had a suite.
--
-- Synthetic fixtures only. Disposable database only.
-- ============================================================
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing pilot-scope fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.sid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('5c0be000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE scope_results (description text, passed boolean, detail text);
CREATE FUNCTION pg_temp.sassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.scope_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

-- ── Fixture: two academies, one of which is the pilot ───────
-- The other academy is not decoration. A suite with only the pilot academy in
-- it passes whether or not the filter works, which is the failure this exists
-- to prevent.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.sid(n), 'scope-' || n || '@test.invalid', now() FROM generate_series(1, 6) n;

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.sid(1), 'coach',  'Pilot Coach'),
  (pg_temp.sid(2), 'coach',  'Other Academy Coach'),
  (pg_temp.sid(3), 'coach',  'Unattached Coach'),
  (pg_temp.sid(4), 'player', 'Pilot Player'),
  (pg_temp.sid(5), 'club',   'Administrator'),
  (pg_temp.sid(6), 'player', 'Other Academy Player');

INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.sid(101), pg_temp.sid(5), 'Pilot Academy', 'SCOPE-PILOT'),
  (pg_temp.sid(102), pg_temp.sid(5), 'Other Academy', 'SCOPE-OTHER');

-- Coach 3 has no academy at all: the "months of old seed data" case.
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.sid(1), pg_temp.sid(101)),
  (pg_temp.sid(2), pg_temp.sid(102)),
  (pg_temp.sid(3), NULL);

INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.sid(201), pg_temp.sid(1), 'Pilot Player',         pg_temp.sid(4)),
  (pg_temp.sid(202), pg_temp.sid(2), 'Other Academy Player', pg_temp.sid(6)),
  (pg_temp.sid(203), pg_temp.sid(2), 'Other Academy Player 2', NULL),
  (pg_temp.sid(204), pg_temp.sid(3), 'Stale Seed Player',    NULL);

-- Both academies play a fixture, so pilot_match_coverage has rows from each to
-- tell apart. Without this the D-section assertions would be vacuously true on
-- an empty view, which is the failure mode this whole suite is about.
INSERT INTO public.coach_calendar_events (coach_user_id, title, event_type, starts_at, opponent) VALUES
  (pg_temp.sid(1), 'Pilot fixture', 'match', now() - interval '2 days', 'Rivals A'),
  (pg_temp.sid(2), 'Other fixture', 'match', now() - interval '2 days', 'Rivals B');


-- ── A. Unscoped: the behaviour the migration describes ──────
-- org_id starts NULL. Asserted rather than assumed, because every assertion
-- below is about the difference between the two states.

UPDATE public.pilot_config SET org_id = NULL WHERE id;

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_coach_ids()) = 3,
  'A1 unscoped: every coach counts, including the unattached one',
  (SELECT count(*)::text FROM public.pilot_coach_ids()));

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_activation WHERE cohort = 'player') = 4,
  'A2 unscoped: all four roster rows count',
  (SELECT count(*)::text FROM public.pilot_activation WHERE cohort = 'player'));


-- ── B. Scoped to the pilot academy ──────────────────────────

UPDATE public.pilot_config SET org_id = pg_temp.sid(101) WHERE id;

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_coach_ids()) = 1,
  'B1 scoped: only the pilot academy''s coach counts',
  (SELECT count(*)::text FROM public.pilot_coach_ids()));

-- Stated as "nobody else is in the set" rather than "the single row equals X".
-- The equality form raises "more than one row returned by a subquery" when the
-- filter regresses, which aborts the suite at this line and hides every
-- assertion after it. A guard that dies instead of reporting is most of the
-- way back to a guard that says nothing.
SELECT pg_temp.sassert(
  EXISTS (SELECT 1 FROM public.pilot_coach_ids() WHERE coach_user_id = pg_temp.sid(1))
  AND NOT EXISTS (SELECT 1 FROM public.pilot_coach_ids() WHERE coach_user_id <> pg_temp.sid(1)),
  'B2 scoped: the set is exactly the pilot coach and nobody else',
  (SELECT string_agg(p.full_name, ', ') FROM public.pilot_coach_ids() c
     JOIN public.profiles p ON p.user_id = c.coach_user_id));

-- The number alone is not the claim. "One row" would also be satisfied by
-- counting the wrong academy, so name the row that must be there and the rows
-- that must not.
SELECT pg_temp.sassert(
  EXISTS (SELECT 1 FROM public.pilot_activation WHERE cohort = 'player' AND who = 'Pilot Player'),
  'B3 scoped: the pilot academy''s player IS counted');

SELECT pg_temp.sassert(
  NOT EXISTS (SELECT 1 FROM public.pilot_activation
              WHERE cohort = 'player' AND who LIKE 'Other Academy%'),
  'B4 scoped: the other academy''s players are NOT counted',
  (SELECT string_agg(who, ', ') FROM public.pilot_activation
   WHERE cohort = 'player' AND who LIKE 'Other Academy%'));

SELECT pg_temp.sassert(
  NOT EXISTS (SELECT 1 FROM public.pilot_activation
              WHERE cohort = 'player' AND who = 'Stale Seed Player'),
  'B5 scoped: a coach with no academy is NOT counted');

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_activation WHERE cohort = 'player') = 1,
  'B6 scoped: one row, and B3-B5 say which',
  (SELECT count(*)::text FROM public.pilot_activation WHERE cohort = 'player'));


-- ── C. The denominator is what actually broke ───────────────
-- 3.2% against a claimed ~54% was a denominator fault, not a numerator one.
-- Scoping has to move both, so assert the ratio rather than the count.

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_activation WHERE cohort = 'player')
    < (SELECT count(*) FROM public.squad_players),
  'C1 the scoped denominator is smaller than every roster row in the database',
  (SELECT count(*)::text FROM public.squad_players) || ' rows exist');


-- ── D. Every view that reaches through pilot_coach_ids ──────
-- Four views consult it. Asserting only pilot_activation would leave the other
-- three able to regress silently.

-- D0 is the control D1 needs. An empty view satisfies "contains nothing from
-- the other academy" without the filter doing any work at all.
SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_match_coverage) > 0,
  'D0-control pilot_match_coverage returns rows at all',
  (SELECT count(*)::text FROM public.pilot_match_coverage));

SELECT pg_temp.sassert(
  NOT EXISTS (
    SELECT 1 FROM public.pilot_match_coverage mc
    JOIN public.squad_players sp ON sp.linked_player_id = mc.player_user_id
    WHERE sp.coach_user_id <> pg_temp.sid(1)),
  'D1 pilot_match_coverage contains no player from outside the pilot academy');

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_assessment_rate) >= 0,
  'D2 pilot_assessment_rate evaluates under a non-NULL org_id');

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_rating_agreement_derived) >= 0,
  'D3 pilot_rating_agreement_derived evaluates under a non-NULL org_id');


-- ── E. The week window is configuration, and a stale one empties it ─
-- 20260901000003 seeds pilot_config with `starts_on = CURRENT_DATE`, so the row
-- records when the migration ran rather than when the pilot begins. On the live
-- project that makes it 22 July, which puts 25 September in week 10 of a window
-- that stops at week 8.
--
-- Nothing here can read the live value: a disposable database seeds starts_on to
-- today and is therefore always correct. What these assertions pin is the
-- COUPLING — that the scorecard's entire content depends on this one row, and
-- that a stale value empties it SILENTLY rather than failing. That is the part
-- worth protecting, because an empty scorecard on day one reads as "no data yet"
-- and is indistinguishable from the thing you would expect to see anyway.

INSERT INTO public.telemetry_events (user_id, role, event_type, created_at) VALUES
  (pg_temp.sid(4), 'player', 'opened_app', now()),
  (pg_temp.sid(4), 'player', 'opened_app', now() + interval '8 days');

UPDATE public.pilot_config SET starts_on = CURRENT_DATE WHERE id;

-- E0 is the control E2 needs. "The view is empty" is satisfied by a view that
-- was never populated, so prove it holds rows before proving the date empties it.
SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_retention) > 0,
  'E0-control pilot_retention returns rows when starts_on is the true start date',
  (SELECT count(*)::text FROM public.pilot_retention));

SELECT pg_temp.sassert(
  public.pilot_week(now()) = 1,
  'E1 day one is week 1 when starts_on is the true start date',
  public.pilot_week(now())::text);

-- Nine weeks stale reproduces the live offset: 22 July against a 25 September
-- start is week 10, one clear of the eight-week window.
UPDATE public.pilot_config SET starts_on = CURRENT_DATE - 63 WHERE id;

SELECT pg_temp.sassert(
  public.pilot_week(now()) > (SELECT weeks FROM public.pilot_config WHERE id),
  'E2 a stale starts_on puts today past the end of its own reporting window',
  public.pilot_week(now())::text || ' > ' || (SELECT weeks::text FROM public.pilot_config WHERE id));

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_retention) = 0,
  'E3 and empties pilot_retention entirely — scorecard metrics 6 and 7 vanish',
  (SELECT count(*)::text FROM public.pilot_retention));

SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_scorecard WHERE player_return_pct IS NOT NULL
                                                  OR parent_return_pct IS NOT NULL) = 0,
  'E4 taking the scorecard''s retention columns with it');

-- The silence is the finding. If this ever starts failing because the scorecard
-- errors or returns nothing at all, that is an improvement, not a regression.
SELECT pg_temp.sassert(
  (SELECT count(*) FROM public.pilot_scorecard) = (SELECT weeks FROM public.pilot_config WHERE id),
  'E5 while still returning a full set of rows, which is why this fails silently',
  (SELECT count(*)::text FROM public.pilot_scorecard));

UPDATE public.pilot_config SET starts_on = CURRENT_DATE WHERE id;


-- ── Report ──────────────────────────────────────────────────
DO $test$
DECLARE failures text; n_passed int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE passed), count(*) INTO n_passed, total FROM pg_temp.scope_results;
  SELECT string_agg(description || coalesce(' [' || detail || ']', ''), E'\n' ORDER BY description)
  INTO failures FROM pg_temp.scope_results WHERE NOT passed;
  RAISE NOTICE 'Pilot scope: % of % assertions passed', n_passed, total;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'Pilot scope: % of % assertions failed', total - n_passed, total
      USING DETAIL = failures;
  END IF;
END;
$test$;

ROLLBACK;

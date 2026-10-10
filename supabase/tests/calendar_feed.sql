-- @trak-suite mode=--calendar-feed-review in-all=true
-- TRAK-132 (J8.9): what a private calendar link shows. calendar_feed_for_token
-- is called by the calendar-feed endpoint with the service role, because a
-- phone's calendar app cannot sign in. It must show exactly what the link's
-- owner could read in the app (J8.2's rule, the same function), and nothing
-- once that access ends:
--   - a player's or parent's link shows that squad's published events;
--   - never a draft, another squad, another academy, a withdrawn child, a
--     departed coach or a revoked link;
--   - an unknown token is null (the endpoint answers 404); a dead link is an
--     empty list (the phone removes the events);
--   - the answer has exactly the shape the endpoint validates, and no
--     cancel reason or coach note;
--   - every fetch is recorded.
-- Synthetic fixtures, disposable database only; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing calendar-feed fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.cf(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('9c200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE cf_results (description text, passed boolean, detail text);
GRANT INSERT ON cf_results TO anon, authenticated, service_role;
CREATE TEMP TABLE cf_tokens (label text PRIMARY KEY, token text);
GRANT INSERT, SELECT, UPDATE ON cf_tokens TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.cf_as(n integer) RETURNS void LANGUAGE sql AS $test$
  SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.cf(n))::text, true)::text
$test$;
CREATE FUNCTION pg_temp.cf_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.cf_results VALUES (description, coalesce(ok, false), detail);
$test$;
CREATE FUNCTION pg_temp.cf_refused(statement text, expected text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION USING ERRCODE = 'ZCF01', MESSAGE = 'unexpectedly allowed';
  EXCEPTION
    WHEN SQLSTATE 'ZCF01' THEN failure := 'unexpectedly allowed';
    WHEN OTHERS THEN
      ok := SQLSTATE = expected;
      IF NOT ok THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.cf_results VALUES (description, ok, failure);
END;
$test$;
CREATE FUNCTION pg_temp.cf_token(p_label text) RETURNS text LANGUAGE sql AS $test$
  SELECT token FROM pg_temp.cf_tokens WHERE label = p_label;
$test$;
-- The feed, as the endpoint calls it. Errors become NULL plus a failed check.
CREATE FUNCTION pg_temp.cf_feed(p_label text) RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE result jsonb;
BEGIN
  BEGIN
    result := public.calendar_feed_for_token(pg_temp.cf_token(p_label));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp.cf_results VALUES ('feed call for ' || p_label || ' did not error', false, SQLSTATE || ': ' || SQLERRM);
    RETURN NULL;
  END;
  RETURN result;
END;
$test$;
-- The suite's event ids in a feed, by their last three digits.
CREATE FUNCTION pg_temp.cf_ids(feed jsonb) RETURNS text LANGUAGE sql AS $test$
  SELECT coalesce(string_agg(right(e->>'id', 3), ',' ORDER BY e->>'id'), 'none')
  FROM jsonb_array_elements(coalesce(feed->'events', '[]'::jsonb)) e;
$test$;
CREATE FUNCTION pg_temp.cf_event(feed jsonb, n integer) RETURNS jsonb LANGUAGE sql AS $test$
  SELECT e FROM jsonb_array_elements(feed->'events') e WHERE e->>'id' = pg_temp.cf(n)::text;
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy X (100): coach A (10, U15 squad), coach B (11, U13 squad).
-- Academy Y (101): coach Y (12).
-- Child 20 "Omar Haddad" on A's squad, parent 30. Child 21 on B's squad.
-- Child 22 on Y's squad, parent 32. Adult 23 on A's squad, row coach_departed.
-- Child 25 on A's squad, never consented.
INSERT INTO auth.users (id, email, email_confirmed_at)
  SELECT pg_temp.cf(n), 'synthetic-' || n || '@calendar-feed.invalid', now()
  FROM unnest(ARRAY[1, 2, 10, 11, 12, 20, 21, 22, 23, 25, 30, 32]) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.cf(1), 'club', 'Feed Admin X'), (pg_temp.cf(2), 'club', 'Feed Admin Y'),
  (pg_temp.cf(10), 'coach', 'Feed Coach A'), (pg_temp.cf(11), 'coach', 'Feed Coach B'), (pg_temp.cf(12), 'coach', 'Feed Coach Y'),
  (pg_temp.cf(20), 'player', 'Omar Haddad'), (pg_temp.cf(21), 'player', 'Feed Child B'),
  (pg_temp.cf(22), 'player', 'Feed Child Y'), (pg_temp.cf(23), 'player', 'Feed Adult'),
  (pg_temp.cf(25), 'player', 'Feed Unconsented'), (pg_temp.cf(30), 'parent', 'Feed Parent'),
  (pg_temp.cf(32), 'parent', 'Feed Parent Y');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.cf(100), pg_temp.cf(1), 'Feed Academy X', 'CF-AX1'),
  (pg_temp.cf(101), pg_temp.cf(2), 'Feed Academy Y', 'CF-AY1');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.cf(10), pg_temp.cf(100)), (pg_temp.cf(11), pg_temp.cf(100)), (pg_temp.cf(12), pg_temp.cf(101));
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.cf(20), current_date - interval '13 years'), (pg_temp.cf(21), current_date - interval '11 years'),
  (pg_temp.cf(22), current_date - interval '13 years'), (pg_temp.cf(23), current_date - interval '20 years'),
  (pg_temp.cf(25), current_date - interval '13 years');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES (pg_temp.cf(20), pg_temp.cf(30)), (pg_temp.cf(22), pg_temp.cf(32));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group, linked_player_id) VALUES
  (pg_temp.cf(40), pg_temp.cf(10), 'Omar Haddad', 'U15', pg_temp.cf(20)),
  (pg_temp.cf(41), pg_temp.cf(11), 'Feed Child B', 'U13', pg_temp.cf(21)),
  (pg_temp.cf(42), pg_temp.cf(12), 'Feed Child Y', 'U15', pg_temp.cf(22)),
  (pg_temp.cf(43), pg_temp.cf(10), 'Feed Adult', 'U15', pg_temp.cf(23)),
  (pg_temp.cf(45), pg_temp.cf(10), 'Feed Unconsented', 'U15', pg_temp.cf(25));
UPDATE public.squad_players SET status = 'coach_departed' WHERE id = pg_temp.cf(43);

-- 500 A match (published), 501 A draft, 502 B published, 503 Y published,
-- 504 A published then cancelled, 505 A 120 days ago, 506 A 30 days ago.
INSERT INTO public.coach_calendar_events
  (id, coach_user_id, title, event_type, starts_at, event_date, start_time, end_time, meet_time, kit, home_away, opponent, venue, notes, published)
VALUES
  (pg_temp.cf(500), pg_temp.cf(10), 'League', 'match', now() + interval '30 days', current_date + 30, '10:00', '11:30', '09:15', 'White', 'away', 'Rivals FC', 'Rivals Park', 'Coach note: Omar starts', true),
  (pg_temp.cf(501), pg_temp.cf(10), 'Draft', 'training', now() + interval '31 days', current_date + 31, '17:00', NULL, NULL, NULL, NULL, NULL, 'Main pitch', NULL, false),
  (pg_temp.cf(502), pg_temp.cf(11), 'B training', 'training', now() + interval '30 days', current_date + 30, '16:00', NULL, NULL, NULL, NULL, NULL, 'Pitch 2', NULL, true),
  (pg_temp.cf(503), pg_temp.cf(12), 'Y training', 'training', now() + interval '30 days', current_date + 30, '16:00', NULL, NULL, NULL, NULL, NULL, 'Y ground', NULL, true),
  (pg_temp.cf(504), pg_temp.cf(10), 'Training', 'training', now() + interval '32 days', current_date + 32, NULL, NULL, NULL, NULL, NULL, NULL, 'Main pitch', NULL, true),
  (pg_temp.cf(505), pg_temp.cf(10), 'Old', 'training', now() - interval '120 days', current_date - 120, '17:00', NULL, NULL, NULL, NULL, NULL, 'Main pitch', NULL, true),
  (pg_temp.cf(506), pg_temp.cf(10), 'Recent', 'training', now() - interval '30 days', current_date - 30, '17:00', NULL, NULL, NULL, NULL, NULL, 'Main pitch', NULL, true);
UPDATE public.coach_calendar_events SET status = 'cancelled', cancel_reason = 'Omar is ill' WHERE id = pg_temp.cf(504);

-- Consent and links, the way the app records them.
SET LOCAL ROLE authenticated;
SELECT pg_temp.cf_as(30);
SELECT public.record_parental_consent(pg_temp.cf(20), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT pg_temp.cf_as(32);
SELECT public.record_parental_consent(pg_temp.cf(22), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT pg_temp.cf_as(20); INSERT INTO pg_temp.cf_tokens SELECT 'player', public.create_my_calendar_link();
SELECT pg_temp.cf_as(30); INSERT INTO pg_temp.cf_tokens SELECT 'parent', public.create_my_calendar_link();
SELECT pg_temp.cf_as(23); INSERT INTO pg_temp.cf_tokens SELECT 'departed', public.create_my_calendar_link();
SELECT pg_temp.cf_as(25); INSERT INTO pg_temp.cf_tokens SELECT 'unconsented', public.create_my_calendar_link();
SELECT pg_temp.cf_as(22); INSERT INTO pg_temp.cf_tokens SELECT 'other-academy', public.create_my_calendar_link();
SELECT pg_temp.cf_as(21); INSERT INTO pg_temp.cf_tokens SELECT 'other-squad', public.create_my_calendar_link();
SELECT pg_temp.cf_as(20); INSERT INTO pg_temp.cf_tokens SELECT 'revoked', public.create_my_calendar_link();
SELECT pg_temp.cf_as(20); INSERT INTO pg_temp.cf_tokens SELECT 'player', public.create_my_calendar_link() ON CONFLICT (label) DO UPDATE SET token = EXCLUDED.token;
RESET ROLE;

SET LOCAL ROLE service_role;

-- ── 1. Unknown and malformed tokens are null (404) ──────────────────────────
SELECT pg_temp.cf_check(public.calendar_feed_for_token(repeat('A', 43)) IS NULL, 'a token that never existed is null');
SELECT pg_temp.cf_check(public.calendar_feed_for_token('not-a-token') IS NULL, 'a malformed token is null');
SELECT pg_temp.cf_check(public.calendar_feed_for_token(NULL) IS NULL, 'no token is null');

-- ── 2. A player's link: their squad's published events ──────────────────────
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('player')) = '500,504,506',
  'the player link shows their squad''s published events: not the draft, other squads, other academies, or events older than 60 days',
  pg_temp.cf_ids(pg_temp.cf_feed('player')));
SELECT pg_temp.cf_check(
  (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) =
     ARRAY['date','endTime','homeAway','id','kind','kit','meetTime','opponent','sequence','squadLabel','startTime','status','updatedAt','venue'])
   FROM jsonb_array_elements(pg_temp.cf_feed('player')->'events') e),
  'every event has exactly the fields the endpoint validates: no cancel reason, no coach note, no title');
SELECT pg_temp.cf_check(
  pg_temp.cf_event(pg_temp.cf_feed('player'), 500) @> jsonb_build_object(
    'kind', 'match', 'squadLabel', 'U15', 'date', to_char(current_date + 30, 'YYYY-MM-DD'), 'startTime', '10:00', 'endTime', '11:30',
    'meetTime', '09:15', 'kit', 'White', 'homeAway', 'away', 'opponent', 'Rivals FC', 'venue', 'Rivals Park', 'status', 'scheduled', 'sequence', 0),
  'a match carries its day, times, meet time, kit, home or away, opponent and venue', pg_temp.cf_event(pg_temp.cf_feed('player'), 500)::text);
SELECT pg_temp.cf_check((pg_temp.cf_event(pg_temp.cf_feed('player'), 500)->>'updatedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$',
  'updatedAt is an exact UTC instant');
SELECT pg_temp.cf_check(
  pg_temp.cf_event(pg_temp.cf_feed('player'), 504) @> '{"status":"cancelled","sequence":1,"startTime":null}'::jsonb,
  'a cancelled event stays, marked cancelled, with its change counter moved on; an untimed event has no time',
  pg_temp.cf_event(pg_temp.cf_feed('player'), 504)::text);
SELECT pg_temp.cf_check(pg_temp.cf_feed('player')->'child_names' ? 'Omar Haddad',
  'the answer names the child, so the endpoint can drop any detail that mentions them');
-- Imad's #258 review: coach free text can name ANOTHER child in the squad
-- ("Lucas brings the bibs"), and that would reach every other family's
-- calendar. So the names cover every child in the squads the feed shows.
SELECT pg_temp.cf_check(pg_temp.cf_feed('player')->'child_names' ? 'Feed Unconsented',
  'the answer also names squad-mates, so a detail naming another child in the squad is dropped too',
  (pg_temp.cf_feed('player')->'child_names')::text);
SELECT pg_temp.cf_check(NOT (pg_temp.cf_feed('player')->'child_names' ? 'Feed Child Y'),
  'it does not hand over names from another academy''s squad',
  (pg_temp.cf_feed('player')->'child_names')::text);

-- ── 3. The parent's link shows the same; other readers see their own ────────
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('parent')) = '500,504,506', 'the parent''s link shows the child''s events',
  pg_temp.cf_ids(pg_temp.cf_feed('parent')));
SELECT pg_temp.cf_check(pg_temp.cf_feed('parent')->'child_names' ? 'Omar Haddad', 'the parent''s answer names their child');
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('other-academy')) = '503',
  'a consented child in another academy sees only their own academy''s event', pg_temp.cf_ids(pg_temp.cf_feed('other-academy')));
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('departed')) = 'none',
  'an adult whose squad row is coach_departed sees nothing from that coach', pg_temp.cf_ids(pg_temp.cf_feed('departed')));
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('unconsented')) = 'none',
  'a child with no consent sees nothing', pg_temp.cf_ids(pg_temp.cf_feed('unconsented')));
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('other-squad')) = 'none',
  'an unconsented child in another squad sees nothing', pg_temp.cf_ids(pg_temp.cf_feed('other-squad')));

-- ── 4. A replaced (revoked) link is an empty list, not null ─────────────────
SELECT pg_temp.cf_check(pg_temp.cf_feed('revoked') = '{"events":[],"child_names":[]}'::jsonb,
  'a revoked link answers an empty calendar, so the phone removes the events', pg_temp.cf_feed('revoked')::text);

-- ── 5. Every fetch is recorded ─────────────────────────────────────────────
RESET ROLE;
SELECT pg_temp.cf_check(
  (SELECT last_fetched_at IS NOT NULL FROM public.calendar_links WHERE token_hash = encode(sha256(convert_to(pg_temp.cf_token('player'), 'UTF8')), 'hex')),
  'a fetch records last_fetched_at on the link');
SELECT pg_temp.cf_check(
  (SELECT last_fetched_at IS NOT NULL FROM public.calendar_links WHERE token_hash = encode(sha256(convert_to(pg_temp.cf_token('revoked'), 'UTF8')), 'hex')),
  'a fetch of a revoked link is recorded too: something is still subscribed to it');

-- ── 6. Withdrawal empties the feed on the next fetch ────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.cf_as(30);
SELECT public.withdraw_parental_consent(pg_temp.cf(20));
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('player')) = 'none', 'after withdrawal the child''s link shows nothing',
  pg_temp.cf_ids(pg_temp.cf_feed('player')));
SELECT pg_temp.cf_check(pg_temp.cf_ids(pg_temp.cf_feed('parent')) = 'none', 'after withdrawal the parent''s link shows nothing',
  pg_temp.cf_ids(pg_temp.cf_feed('parent')));
SELECT pg_temp.cf_check(pg_temp.cf_feed('player') IS NOT NULL, 'a withdrawn child''s link still answers (empty), not 404');
RESET ROLE;

-- ── 7. Only the service role may call it ───────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.cf_as(20);
SELECT pg_temp.cf_refused(format('SELECT public.calendar_feed_for_token(%L)', pg_temp.cf_token('parent')), '42501',
  'a signed-in user cannot call the feed function, even with someone else''s token');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.cf_refused(format('SELECT public.calendar_feed_for_token(%L)', pg_temp.cf_token('parent')), '42501',
  'a signed-out caller cannot call the feed function');
RESET ROLE;

DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.cf_results;
  IF total <> 25 THEN
    RAISE EXCEPTION 'Calendar feed: % assertions ran; expected exactly 25 (% failed: %)', total, failed,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.cf_results WHERE NOT passed);
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Calendar feed: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.cf_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Calendar feed: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

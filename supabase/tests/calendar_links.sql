-- @trak-suite mode=--calendar-links-review in-all=true
-- TRAK-132 (J8.9): private calendar links, one per person. The link is the
-- credential a phone's calendar app uses, so:
--   - the database keeps only a sha256 hash of the token, never the token;
--   - a player or parent makes their own link, and making a new one revokes
--     the old one (a lost or shared link is fixed by replacing it);
--   - nobody reads or writes the table directly, and nobody touches another
--     person's link.
-- What a link shows (published events, consent, squad) is
-- calendar_feed_for_token, which follows J8.2. Real SQL roles, synthetic
-- fixtures, disposable database only; one transaction that rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing calendar-link fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.cl(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('9c100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE cl_results (description text, passed boolean, detail text);
GRANT INSERT ON cl_results TO anon, authenticated, service_role;
-- Tokens handed back to callers, kept for the checks below.
CREATE TEMP TABLE cl_tokens (label text PRIMARY KEY, token text);
GRANT INSERT, SELECT ON cl_tokens TO anon, authenticated;

CREATE FUNCTION pg_temp.cl_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.cl_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.cl_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- Expects SQLSTATE `expected`; an unexpected success is rolled back.
CREATE FUNCTION pg_temp.cl_refused(statement text, expected text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION USING ERRCODE = 'ZCL01', MESSAGE = 'unexpectedly allowed';
  EXCEPTION
    WHEN SQLSTATE 'ZCL01' THEN failure := 'unexpectedly allowed';
    WHEN OTHERS THEN
      ok := SQLSTATE = expected;
      IF NOT ok THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.cl_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.cl_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.cl_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- The table is closed to app roles; the checks read it as its owner.
CREATE FUNCTION pg_temp.cl_rows(p_uid uuid) RETURNS TABLE (token_hash text, revoked boolean)
LANGUAGE sql SECURITY DEFINER AS $test$
  SELECT token_hash, revoked_at IS NOT NULL FROM public.calendar_links WHERE user_id = p_uid ORDER BY created_at, id;
$test$;
CREATE FUNCTION pg_temp.cl_hash(p_token text) RETURNS text LANGUAGE sql IMMUTABLE AS $test$
  SELECT encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$test$;
CREATE FUNCTION pg_temp.cl_token(p_label text) RETURNS text LANGUAGE sql AS $test$
  SELECT token FROM pg_temp.cl_tokens WHERE label = p_label;
$test$;

-- ── Fixtures (trusted setup, as the table owner) ───────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.cl(1),  'admin@calendar-links.test',  now()),
  (pg_temp.cl(2),  'coach@calendar-links.test',  now()),
  (pg_temp.cl(10), 'player@calendar-links.test', now()),
  (pg_temp.cl(11), 'player2@calendar-links.test', now()),
  (pg_temp.cl(20), 'parent@calendar-links.test', now()),
  (pg_temp.cl(30), 'noprofile@calendar-links.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.cl(1),  'club',   'Calendar Links Admin'),
  (pg_temp.cl(2),  'coach',  'Calendar Links Coach'),
  (pg_temp.cl(10), 'player', 'Synthetic Player'),
  (pg_temp.cl(11), 'player', 'Synthetic Player Two'),
  (pg_temp.cl(20), 'parent', 'Synthetic Parent');

SET LOCAL ROLE authenticated;

-- ── 1. A player makes a link: the token comes back once, only its hash is kept ─
SELECT pg_temp.cl_as(pg_temp.cl(10));
SELECT pg_temp.cl_allowed($s$INSERT INTO pg_temp.cl_tokens SELECT 'player-1', public.create_my_calendar_link()$s$,
  'a player can make a calendar link');
SELECT pg_temp.cl_check(pg_temp.cl_token('player-1') ~ '^[A-Za-z0-9_-]{43}$',
  'the token is 43 url-safe characters, the format the feed endpoint accepts', pg_temp.cl_token('player-1'));
SELECT pg_temp.cl_check(
  (SELECT count(*) = 1 AND bool_and(NOT revoked) AND bool_and(token_hash = pg_temp.cl_hash(pg_temp.cl_token('player-1')))
     FROM pg_temp.cl_rows(pg_temp.cl(10))),
  'the database keeps one live row holding the sha256 of the token');
SELECT pg_temp.cl_check(
  NOT EXISTS (SELECT 1 FROM pg_temp.cl_rows(pg_temp.cl(10)) r WHERE r.token_hash = pg_temp.cl_token('player-1')),
  'the token itself is never stored');

-- ── 2. A new link replaces the old one ─────────────────────────────────────
SELECT pg_temp.cl_allowed($s$INSERT INTO pg_temp.cl_tokens SELECT 'player-2', public.create_my_calendar_link()$s$,
  'the player can make a replacement link');
SELECT pg_temp.cl_check(pg_temp.cl_token('player-2') IS DISTINCT FROM pg_temp.cl_token('player-1'),
  'the replacement is a different token');
SELECT pg_temp.cl_check(
  (SELECT count(*) FILTER (WHERE NOT revoked) = 1 AND count(*) = 2 FROM pg_temp.cl_rows(pg_temp.cl(10))),
  'making a new link revokes the old one: exactly one live link');
SELECT pg_temp.cl_check(
  (SELECT bool_and(revoked) FROM pg_temp.cl_rows(pg_temp.cl(10)) r WHERE r.token_hash = pg_temp.cl_hash(pg_temp.cl_token('player-1'))),
  'the old link is the revoked one');

-- ── 3. Status without the token ────────────────────────────────────────────
SELECT pg_temp.cl_check(
  (SELECT count(*) = 1 AND bool_and(created_at IS NOT NULL AND last_fetched_at IS NULL) FROM public.my_calendar_link()),
  'my_calendar_link reports the live link: created, never fetched yet');
SELECT pg_temp.cl_check(
  NOT EXISTS (SELECT 1 FROM information_schema.routines r
              JOIN information_schema.parameters p ON p.specific_name = r.specific_name
              WHERE r.routine_schema = 'public' AND r.routine_name = 'my_calendar_link'
                AND p.parameter_mode = 'OUT' AND p.parameter_name ILIKE '%token%'),
  'my_calendar_link returns no token or hash column');

-- ── 4. A parent can make one; staff and accounts without a profile cannot ──
SELECT pg_temp.cl_as(pg_temp.cl(20));
SELECT pg_temp.cl_allowed($s$INSERT INTO pg_temp.cl_tokens SELECT 'parent-1', public.create_my_calendar_link()$s$,
  'a parent can make a calendar link');
SELECT pg_temp.cl_as(pg_temp.cl(2));
SELECT pg_temp.cl_refused($s$SELECT public.create_my_calendar_link()$s$, '42501', 'a coach cannot make a family calendar link');
SELECT pg_temp.cl_as(pg_temp.cl(1));
SELECT pg_temp.cl_refused($s$SELECT public.create_my_calendar_link()$s$, '42501', 'an academy admin cannot make one');
SELECT pg_temp.cl_as(pg_temp.cl(30));
SELECT pg_temp.cl_refused($s$SELECT public.create_my_calendar_link()$s$, '42501', 'an account with no profile cannot make one');

-- ── 5. Nobody touches the table directly, or another person's link ─────────
SELECT pg_temp.cl_as(pg_temp.cl(11));
SELECT pg_temp.cl_refused($s$SELECT 1 FROM public.calendar_links$s$, '42501', 'app users cannot read the links table');
SELECT pg_temp.cl_refused(format($s$INSERT INTO public.calendar_links (user_id, token_hash) VALUES (%L, %L)$s$,
  pg_temp.cl(11), repeat('a', 64)), '42501', 'app users cannot insert a link of their own choosing');
SELECT pg_temp.cl_refused($s$UPDATE public.calendar_links SET revoked_at = NULL$s$, '42501', 'app users cannot un-revoke a link');
SELECT pg_temp.cl_check(NOT EXISTS (SELECT 1 FROM public.my_calendar_link()),
  'another player sees no link of their own');
SELECT pg_temp.cl_allowed($s$SELECT public.revoke_my_calendar_link()$s$, 'revoking with no link is harmless');
SELECT pg_temp.cl_check(
  (SELECT count(*) FILTER (WHERE NOT revoked) = 1 FROM pg_temp.cl_rows(pg_temp.cl(10))),
  'another player''s revoke leaves the first player''s link alive');

-- ── 6. Revoking ends the link ──────────────────────────────────────────────
SELECT pg_temp.cl_as(pg_temp.cl(10));
SELECT pg_temp.cl_check(public.revoke_my_calendar_link(), 'revoke reports that a live link was revoked');
SELECT pg_temp.cl_check(
  (SELECT bool_and(revoked) FROM pg_temp.cl_rows(pg_temp.cl(10))), 'after revoke, no link of the player is live');
SELECT pg_temp.cl_check(NOT EXISTS (SELECT 1 FROM public.my_calendar_link()), 'my_calendar_link shows nothing after revoke');
SELECT pg_temp.cl_check(NOT public.revoke_my_calendar_link(), 'a second revoke reports nothing to revoke');
SELECT pg_temp.cl_as(pg_temp.cl(20));
SELECT pg_temp.cl_check(
  (SELECT count(*) FILTER (WHERE NOT revoked) = 1 FROM pg_temp.cl_rows(pg_temp.cl(20))),
  'CONTROL the parent''s link is untouched by the player''s revoke');

-- ── 7. Signed out: nothing ─────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.cl_refused($s$SELECT public.create_my_calendar_link()$s$, '42501', 'signed-out callers cannot make a link');
SELECT pg_temp.cl_refused($s$SELECT public.revoke_my_calendar_link()$s$, '42501', 'signed-out callers cannot revoke');
SELECT pg_temp.cl_refused($s$SELECT * FROM public.my_calendar_link()$s$, '42501', 'signed-out callers cannot read link status');
SELECT pg_temp.cl_refused($s$SELECT 1 FROM public.calendar_links$s$, '42501', 'signed-out callers cannot read the links table');

RESET ROLE;

-- ── 8. One live link per person, enforced by the table too ─────────────────
SELECT pg_temp.cl_refused(format($s$INSERT INTO public.calendar_links (user_id, token_hash) VALUES (%L, %L)$s$,
  pg_temp.cl(20), repeat('b', 64)), '23505', 'the table refuses a second live link for one person');
SELECT pg_temp.cl_refused(format($s$INSERT INTO public.calendar_links (user_id, token_hash) VALUES (%L, %L)$s$,
  pg_temp.cl(11), pg_temp.cl_hash(pg_temp.cl_token('parent-1'))), '23505', 'two links can never share a token');

DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.cl_results;
  IF total <> 31 THEN
    RAISE EXCEPTION 'Calendar links: % assertions ran; expected exactly 31', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Calendar links: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.cl_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Calendar links: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

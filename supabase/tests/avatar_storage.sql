-- @trak-suite mode=--avatar-access-review in-all=true
-- Avatar-policy regressions. The original #113 suite failed 3 of 6 checks
-- before 20260922143046_restrict_avatar_reads_to_owner.sql and joined --all
-- with that fix. G7 (20260923110906) closed photos to every app role; TRAK-460
-- (20261113150000) reopens exactly one door: a COACH's own photo.
--
-- Measured on production on 22 Sep as anon with only the public key: LIST the
-- bucket returned every object name (object name = user_id), SIGN an object
-- the caller does not own returned a URL, GET returned the image. Cause:
-- "Avatars are publicly readable" FOR SELECT TO public (20260424000003) was
-- never dropped; 20260526000006 only set public = false.
--
-- Kept from before: anon and cross-user denials, and a player's or guardian's
-- photo stays closed even to its owner (child photos are out of scope).
-- New: a coach reads, replaces, deletes and (re)adds their own object and may
-- set profiles.avatar_url to their own user id; another coach cannot touch it,
-- and a coach cannot add an object under someone else's name or point their
-- profile at it. Trusted-maintenance controls prove the fixtures exist.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing avatar-storage fixtures outside the disposable test harness';
  END IF;
END;
$test$;

-- The hosted project grants these; policies decide. Mirror it here.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.aid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE av_results (description text, passed boolean, detail text);
GRANT INSERT ON av_results TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.avassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN INSERT INTO pg_temp.av_results VALUES (description, ok IS TRUE, detail); END;
$test$;
CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',p::text)::text, true); END;
$test$;

-- Real accounts own the photos (a later migration refuses objects whose owner
-- account does not exist, which is correct and must not be bypassed here).
-- 1 and 2 are coaches, 3 a player, 4 a guardian.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.aid(1), 'coach-one@avatar.test', now()), (pg_temp.aid(2), 'coach-two@avatar.test', now()),
  (pg_temp.aid(3), 'player@avatar.test', now()), (pg_temp.aid(4), 'guardian@avatar.test', now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.aid(1), 'coach', 'Coach One'), (pg_temp.aid(2), 'coach', 'Coach Two'),
  (pg_temp.aid(3), 'player', 'Player Three'), (pg_temp.aid(4), 'parent', 'Guardian Four');

INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
-- Everyone has a photo at the flat key the uploader writes, so a denial is the policy, not an empty bucket.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('avatars', pg_temp.aid(1)::text, pg_temp.aid(1)), ('avatars', pg_temp.aid(2)::text, pg_temp.aid(2)),
  ('avatars', pg_temp.aid(3)::text, pg_temp.aid(3)), ('avatars', pg_temp.aid(4)::text, pg_temp.aid(4));

-- ── anon ────────────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
DO $test$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars';
  PERFORM pg_temp.avassert(v = 0, '1 anon cannot list or read any avatar', v || ' object(s) visible to anon');
END;
$test$;
RESET ROLE;

-- ── a player and a guardian: closed even to their own object ────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.aid(3));
DO $test$
DECLARE v int; u int; d int; refused boolean := false;
BEGIN
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars';
  PERFORM pg_temp.avassert(v = 0, '2 a player reads no avatar, not even their own', v || ' visible');
  UPDATE storage.objects SET owner = owner WHERE bucket_id = 'avatars' AND name = pg_temp.aid(3)::text;
  GET DIAGNOSTICS u = ROW_COUNT;
  PERFORM pg_temp.avassert(u = 0, '2 a player cannot replace their own avatar', u || ' updated');
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(3)::text;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.avassert(d = 0, '2 a player cannot delete a hidden avatar (trusted cleanup does that)', d || ' deleted');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', pg_temp.aid(3)::text || '-new', pg_temp.aid(3));
  EXCEPTION WHEN OTHERS THEN refused := true; END;
  PERFORM pg_temp.avassert(refused, '2 a player cannot add an avatar object');
  refused := false;
  BEGIN UPDATE public.profiles SET avatar_url = pg_temp.aid(3)::text WHERE user_id = pg_temp.aid(3);
  EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'PILOT_FEATURE_DISABLED%'; END;
  PERFORM pg_temp.avassert(refused, '2 a player cannot set a profile photo');
END;
$test$;
SELECT pg_temp.as_user(pg_temp.aid(4));
DO $test$
DECLARE v int; refused boolean := false;
BEGIN
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars';
  PERFORM pg_temp.avassert(v = 0, '3 a guardian reads no avatar, not even their own', v || ' visible');
  BEGIN UPDATE public.profiles SET avatar_url = pg_temp.aid(4)::text WHERE user_id = pg_temp.aid(4);
  EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'PILOT_FEATURE_DISABLED%'; END;
  PERFORM pg_temp.avassert(refused, '3 a guardian cannot set a profile photo');
END;
$test$;
RESET ROLE;

-- ── a coach: their own object, and only theirs ──────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.aid(2));
DO $test$
DECLARE v int; d int; refused boolean := false;
BEGIN
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  PERFORM pg_temp.avassert(v = 0, '4 a coach cannot read another coach''s photo', v || ' visible');
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars';
  PERFORM pg_temp.avassert(v = 1, '4 a coach lists only their own photo, no other role''s', v || ' visible');
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.avassert(d = 0, '4 a coach cannot delete another coach''s photo', d || ' deleted');
  BEGIN UPDATE public.profiles SET avatar_url = pg_temp.aid(1)::text WHERE user_id = pg_temp.aid(2);
  EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'PILOT_FEATURE_DISABLED%'; END;
  PERFORM pg_temp.avassert(refused, '4 a coach cannot point their profile at another coach''s photo');
END;
$test$;
SELECT pg_temp.as_user(pg_temp.aid(1));
DO $test$
DECLARE v int; u int; d int; refused boolean := false; shown text;
BEGIN
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  PERFORM pg_temp.avassert(v = 1, '5 a coach reads their own photo', v || ' visible');
  UPDATE storage.objects SET owner = owner WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  GET DIAGNOSTICS u = ROW_COUNT;
  PERFORM pg_temp.avassert(u = 1, '5 a coach replaces their own photo', u || ' updated');
  UPDATE public.profiles SET avatar_url = pg_temp.aid(1)::text WHERE user_id = pg_temp.aid(1);
  SELECT avatar_url INTO shown FROM public.profiles WHERE user_id = pg_temp.aid(1);
  PERFORM pg_temp.avassert(shown = pg_temp.aid(1)::text, '5 a coach sets their profile photo to their own key', shown);
  UPDATE public.profiles SET avatar_url = NULL WHERE user_id = pg_temp.aid(1);
  SELECT avatar_url INTO shown FROM public.profiles WHERE user_id = pg_temp.aid(1);
  PERFORM pg_temp.avassert(shown IS NULL, '5 a coach can clear their profile photo');
  BEGIN INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', pg_temp.aid(2)::text || '-x', pg_temp.aid(1));
  EXCEPTION WHEN OTHERS THEN refused := true; END;
  PERFORM pg_temp.avassert(refused, '5 a coach cannot add an object under another name');
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.avassert(d = 1, '5 a coach removes their own photo', d || ' deleted');
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', pg_temp.aid(1)::text, pg_temp.aid(1));
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  PERFORM pg_temp.avassert(v = 1, '5 a coach adds their own photo again', v || ' visible');
END;
$test$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $test$
DECLARE v int; u int; d int;
BEGIN
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars';
  PERFORM pg_temp.avassert(v = 4, '6-control every retained avatar exists for trusted maintenance', v || ' visible');
  UPDATE storage.objects SET owner = owner WHERE bucket_id = 'avatars' AND name = pg_temp.aid(3)::text;
  GET DIAGNOSTICS u = ROW_COUNT;
  PERFORM pg_temp.avassert(u = 1, '6-control trusted maintenance can update a player''s retained avatar metadata', u || ' updated');
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(3)::text;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.avassert(d = 1, '6-control trusted maintenance can remove a player''s retained avatar row', d || ' deleted');
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.av_results;
  IF total <> 22 THEN RAISE EXCEPTION 'Avatar storage: % assertions ran; expected exactly 22', total; END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Avatar storage: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.av_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Avatar storage: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

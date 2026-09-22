-- @trak-suite mode=--avatar-storage-review in-all=false
-- Acceptance test for the avatars bucket policies. RED on main by design;
-- whichever avatar-policy migration lands flips this to in-all=true.
--
-- Measured on production on 22 Sep as anon with only the public key: LIST the
-- bucket returned every object name (object name = user_id), SIGN an object
-- the caller does not own returned a URL, GET returned the image. Cause:
-- "Avatars are publicly readable" FOR SELECT TO public (20260424000003) was
-- never dropped; 20260526000006 only set public = false. Separately (Kostas):
-- the owner DELETE policy uses storage.foldername(name)[1], which is NULL for
-- the flat key the uploader writes (name = auth.uid()), so no owner can delete
-- their own photo, and delete_my_account() leaves photos behind.
--
-- Every refusal has a control beside it, so a policy that denies everything
-- cannot pass: the owner must still read, replace and delete their own photo.
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
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;

CREATE FUNCTION pg_temp.aid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE av_results (description text, passed boolean, detail text);
GRANT INSERT ON av_results TO anon, authenticated;
CREATE FUNCTION pg_temp.avassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN INSERT INTO pg_temp.av_results VALUES (description, ok IS TRUE, detail); END;
$test$;
CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',p::text)::text, true); END;
$test$;

INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
-- Two users with a photo each, at the flat key the uploader writes.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('avatars', pg_temp.aid(1)::text, pg_temp.aid(1)),
  ('avatars', pg_temp.aid(2)::text, pg_temp.aid(2));

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

-- ── another signed-in user ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.aid(2));
DO $test$
DECLARE v int; d int;
BEGIN
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  PERFORM pg_temp.avassert(v = 0, '2 a signed-in user cannot read someone else''s avatar', v || ' visible');
  SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(2)::text;
  PERFORM pg_temp.avassert(v = 1, '2-control the same user can read their own avatar', v || ' visible');
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.avassert(d = 0, '3 a signed-in user cannot delete someone else''s avatar', d || ' deleted');
END;
$test$;

-- ── the owner ───────────────────────────────────────────────────────────────
SELECT pg_temp.as_user(pg_temp.aid(1));
DO $test$
DECLARE u int; d int;
BEGIN
  UPDATE storage.objects SET owner = owner WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  GET DIAGNOSTICS u = ROW_COUNT;
  PERFORM pg_temp.avassert(u = 1, '4-control the owner can still replace their own avatar', u || ' updated');
  DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = pg_temp.aid(1)::text;
  GET DIAGNOSTICS d = ROW_COUNT;
  PERFORM pg_temp.avassert(d = 1, '4 the owner can delete their own avatar at the flat key the uploader writes', d || ' deleted');
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.av_results;
  IF total <> 6 THEN RAISE EXCEPTION 'Avatar storage: % assertions ran; expected exactly 6', total; END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Avatar storage: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.av_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Avatar storage: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;

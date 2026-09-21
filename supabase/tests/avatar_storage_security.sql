-- @trak-suite mode=--avatar-storage-review in-all=true
-- Real migration policies on the disposable platform boundary. Storage HTTP
-- signing/CDN behavior is verified separately on the approved synthetic project.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing avatar fixtures outside a disposable database';
  END IF;
END;
$test$;

-- The minimal bootstrap omits managed Storage API grants and object uniqueness.
-- Supply only that platform boundary inside this rolled-back test transaction;
-- assertions must exercise policy decisions, not fail from missing privileges.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
CREATE UNIQUE INDEX avatar_fixture_bucket_name ON storage.objects(bucket_id, name);
CREATE FUNCTION pg_temp.av_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;
CREATE TEMP TABLE av_results(description text, passed boolean, detail text);
GRANT INSERT ON av_results TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.av_assert(ok boolean, description text) RETURNS void LANGUAGE sql AS $test$
  INSERT INTO pg_temp.av_results VALUES(description, ok IS TRUE, NULL);
$test$;
CREATE FUNCTION pg_temp.av_denied(statement text, description text) RETURNS void LANGUAGE plpgsql AS $test$
DECLARE refused boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN refused := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.av_results VALUES(description, refused, failure);
END;
$test$;
CREATE FUNCTION pg_temp.av_as(role_name text, user_number integer) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', role_name, 'sub', CASE WHEN user_number IS NULL THEN NULL ELSE pg_temp.av_id(user_number) END)::text, true);
END;
$test$;
CREATE FUNCTION pg_temp.av_reset() RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$test$;

SELECT pg_temp.av_assert((SELECT public IS FALSE FROM storage.buckets WHERE id='avatars'),
  'bucket remains private');
INSERT INTO storage.buckets(id,name,public) VALUES('avatar-unrelated-fixture','avatar-unrelated-fixture',false);
INSERT INTO storage.objects(id,bucket_id,name,owner) VALUES
  (pg_temp.av_id(20),'avatars',pg_temp.av_id(2)::text,pg_temp.av_id(2)),
  (pg_temp.av_id(21),'avatars',pg_temp.av_id(1)::text||'/legacy.png',pg_temp.av_id(1)),
  (pg_temp.av_id(22),'avatars',pg_temp.av_id(2)::text||'/legacy.png',pg_temp.av_id(2)),
  (pg_temp.av_id(23),'avatar-unrelated-fixture',pg_temp.av_id(1)::text,pg_temp.av_id(1));

SELECT pg_temp.av_as('service_role',NULL);
SELECT pg_temp.av_assert((SELECT count(*)=4 FROM storage.objects WHERE id IN
  (pg_temp.av_id(20),pg_temp.av_id(21),pg_temp.av_id(22),pg_temp.av_id(23))),
  'service control sees all four existing fixtures');
SELECT pg_temp.av_reset();

SELECT pg_temp.av_as('anon',NULL);
SELECT pg_temp.av_assert((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='avatars'),
  'anonymous listing cannot discover avatar rows');
SELECT pg_temp.av_assert((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='avatars' AND name=pg_temp.av_id(2)::text),
  'anonymous exact-object lookup has no row to sign or download');
SELECT pg_temp.av_denied(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)','avatars',pg_temp.av_id(3)::text),
  'anonymous upload denied by policy');
SELECT pg_temp.av_reset();

SELECT pg_temp.av_as('authenticated',1);
INSERT INTO storage.objects(id,bucket_id,name,owner)
VALUES(pg_temp.av_id(10),'avatars',pg_temp.av_id(1)::text,pg_temp.av_id(1));
SELECT pg_temp.av_assert((SELECT count(*)=1 FROM storage.objects WHERE id=pg_temp.av_id(10)),
  'owner uploads and selects a bare UUID avatar');
-- This is an actual ON CONFLICT UPDATE, not a second INSERT. Changing the
-- fixture's id makes its execution observable without altering the policy key.
INSERT INTO storage.objects(id,bucket_id,name,owner)
VALUES(pg_temp.av_id(11),'avatars',pg_temp.av_id(1)::text,pg_temp.av_id(1))
ON CONFLICT(bucket_id,name) DO UPDATE SET id=EXCLUDED.id;
SELECT pg_temp.av_assert((SELECT count(*)=1 AND bool_and(id=pg_temp.av_id(11)) FROM storage.objects
  WHERE bucket_id='avatars' AND name=pg_temp.av_id(1)::text),
  'owner upsert actually replaces the existing row through UPDATE');
SELECT pg_temp.av_assert((SELECT count(*)=3 FROM storage.objects WHERE id IN
  (pg_temp.av_id(20),pg_temp.av_id(21),pg_temp.av_id(22))),
  'authenticated existing avatar read audience remains unchanged');
SELECT pg_temp.av_assert((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='avatar-unrelated-fixture'),
  'avatar read policy does not open another bucket');
SELECT pg_temp.av_denied(format(
  'INSERT INTO storage.objects(bucket_id,name,owner) VALUES(%L,%L,%L)',
  'avatars',pg_temp.av_id(3)::text,pg_temp.av_id(1)),
  'owner cannot upload at another UUID');
SELECT pg_temp.av_denied(format(
  'UPDATE storage.objects SET name=%L WHERE id=%L',pg_temp.av_id(3)::text,pg_temp.av_id(11)),
  'WITH CHECK prevents owner renaming avatar to another UUID');
WITH changed AS (UPDATE storage.objects SET owner=pg_temp.av_id(1)
  WHERE id=pg_temp.av_id(20) RETURNING id)
SELECT pg_temp.av_assert(count(*)=0,'foreign avatar update affects zero rows') FROM changed;
WITH removed AS (DELETE FROM storage.objects WHERE id=pg_temp.av_id(20) RETURNING id)
SELECT pg_temp.av_assert(count(*)=0,'foreign bare avatar delete affects zero rows') FROM removed;
WITH removed AS (DELETE FROM storage.objects WHERE id=pg_temp.av_id(22) RETURNING id)
SELECT pg_temp.av_assert(count(*)=0,'foreign legacy folder delete affects zero rows') FROM removed;
WITH removed AS (DELETE FROM storage.objects WHERE id=pg_temp.av_id(23) RETURNING id)
SELECT pg_temp.av_assert(count(*)=0,'own UUID in another bucket cannot be deleted') FROM removed;
WITH removed AS (DELETE FROM storage.objects WHERE id=pg_temp.av_id(11) RETURNING id)
SELECT pg_temp.av_assert(count(*)=1,'owner removes actual bare UUID avatar') FROM removed;
WITH removed AS (DELETE FROM storage.objects WHERE id=pg_temp.av_id(21) RETURNING id)
SELECT pg_temp.av_assert(count(*)=1,'owner still removes prior own-folder avatar') FROM removed;
SELECT pg_temp.av_reset();

SELECT pg_temp.av_assert(NOT EXISTS(SELECT 1 FROM storage.objects WHERE id IN(pg_temp.av_id(11),pg_temp.av_id(21))),
  'privileged verification confirms both own objects are gone');
SELECT pg_temp.av_assert((SELECT count(*)=3 FROM storage.objects WHERE id IN
  (pg_temp.av_id(20),pg_temp.av_id(22),pg_temp.av_id(23))),
  'privileged verification confirms foreign and other-bucket objects survived');

DO $test$
DECLARE failed integer; details text;
BEGIN
  SELECT count(*),string_agg(description||coalesce(' ['||detail||']',''),E'\n' ORDER BY description)
  INTO failed,details FROM pg_temp.av_results WHERE NOT passed;
  IF failed>0 THEN RAISE EXCEPTION 'Avatar Storage security: % failing assertions',failed USING DETAIL=details; END IF;
END;
$test$;
SELECT count(*) AS avatar_storage_assertions FROM pg_temp.av_results;
ROLLBACK;


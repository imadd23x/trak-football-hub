-- @trak-suite mode=--profile-language in-all=true
-- TRAK-406 (Languages 1/8): each person saves the language they picked on their own account. Anyone signed in sets or
-- clears their own; a tag of the wrong shape is refused; nobody changes another person's. Test people are named after
-- footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing profile-language fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t406id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('94060000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t406_results(label text, ok boolean);
GRANT SELECT, INSERT ON t406_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.t406actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t406id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t406check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t406_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.t406refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- The language saved on a person's account, read as the test owner.
CREATE FUNCTION pg_temp.t406lang(n integer) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
 SELECT language FROM public.profiles WHERE user_id = pg_temp.t406id(n)
$$;
-- Set the actor's own language, as Settings does; the statement, so t406refused can run it.
CREATE FUNCTION pg_temp.t406set(n integer, tag text) RETURNS text LANGUAGE sql AS $$
 SELECT format('UPDATE public.profiles SET language = %L WHERE user_id = %L', tag, pg_temp.t406id(n))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- A coach (Otto Rehhagel), a parent (Angelos Charisteas) and a player (Theodoros Zagorakis). Nobody has picked yet.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t406id(n),'synthetic-'||n||'@language406.invalid',now() FROM unnest(ARRAY[10,20,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t406id(10),'coach','Otto Rehhagel'),(pg_temp.t406id(20),'parent','Angelos Charisteas'),
 (pg_temp.t406id(30),'player','Theodoros Zagorakis');

SELECT pg_temp.t406check(pg_temp.t406lang(10) IS NULL AND pg_temp.t406lang(30) IS NULL,
  '0 nobody has a language until they pick one');

SET LOCAL ROLE authenticated;

-- ── 1. Each person sets and clears their own ────────────────────────────────
SELECT pg_temp.t406actor(10);
UPDATE public.profiles SET language = 'el' WHERE user_id = pg_temp.t406id(10);
SELECT pg_temp.t406check(pg_temp.t406lang(10) = 'el', '1 a coach saves Greek');
SELECT pg_temp.t406check((SELECT language FROM public.profiles WHERE user_id = pg_temp.t406id(10)) = 'el',
  '1 and reads it back');
SELECT pg_temp.t406actor(30);
UPDATE public.profiles SET language = 'en' WHERE user_id = pg_temp.t406id(30);
SELECT pg_temp.t406check(pg_temp.t406lang(30) = 'en', '1 a player saves English');
SELECT pg_temp.t406actor(20);
UPDATE public.profiles SET language = 'pt-BR' WHERE user_id = pg_temp.t406id(20);
SELECT pg_temp.t406check(pg_temp.t406lang(20) = 'pt-BR', '1 a language with a region is a good shape too');
UPDATE public.profiles SET language = NULL WHERE user_id = pg_temp.t406id(20);
SELECT pg_temp.t406check(pg_temp.t406lang(20) IS NULL, '1 a parent clears theirs');

-- ── 2. A tag of the wrong shape is refused ──────────────────────────────────
SELECT pg_temp.t406check(pg_temp.t406refused(pg_temp.t406set(20,'Greek'),'23514'), '2 a language name, not a tag');
SELECT pg_temp.t406check(pg_temp.t406refused(pg_temp.t406set(20,'EL'),'23514'), '2 a tag in capitals');
SELECT pg_temp.t406check(pg_temp.t406refused(pg_temp.t406set(20,''),'23514'), '2 an empty tag');
SELECT pg_temp.t406check(pg_temp.t406lang(20) IS NULL, '2 and the parent''s stays as it was');

-- ── 3. Nobody changes another person's ──────────────────────────────────────
SELECT pg_temp.t406actor(20);
UPDATE public.profiles SET language = 'en' WHERE user_id IN (pg_temp.t406id(10), pg_temp.t406id(30));
SELECT pg_temp.t406check(pg_temp.t406lang(10) = 'el' AND pg_temp.t406lang(30) = 'en',
  '3 a parent cannot change the coach''s or the player''s');
SELECT pg_temp.t406actor(10);
UPDATE public.profiles SET language = 'el' WHERE user_id = pg_temp.t406id(30);
SELECT pg_temp.t406check(pg_temp.t406lang(30) = 'en', '3 a coach cannot change a player''s');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.t406_results;
 IF total <> 12 THEN RAISE EXCEPTION 'Profile language: % checks ran; expected 12', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.t406_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Profile language checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Profile language: % of % passed', total, total;
END $$;
ROLLBACK;

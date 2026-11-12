-- @trak-suite mode=--family-academy in-all=true
-- TRAK-441 slice 2 (Imad, 12 Nov): the family side menu shows the child's academy, its name and logo, as the coach's
-- shows his. family_academy(child) gives a player their own academy and a parent their child's, and nothing else: not
-- another child's, not after the coach left, not to a coach or a stranger, never to anon. Only the name and the logo.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing family-academy fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.fa441id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('94411000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE fa441_results(label text, ok boolean);
GRANT SELECT, INSERT ON fa441_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.fa441actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.fa441id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.fa441check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.fa441_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.fa441refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- What the reader gets for a child: "name|logo", or null for no row.
CREATE FUNCTION pg_temp.fa441read(child integer) RETURNS text LANGUAGE sql AS $$
 SELECT name || '|' || coalesce(logo_url, '') FROM public.family_academy(pg_temp.fa441id(child))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Panathinaikos Academy (100, with a logo): Otto Rehhagel coaches Giourkas Seitaridis and Kostas Katsouranis (coach
-- left). Aris Academy (101, no logo): Fernando Santos coaches Angelos Charisteas. Traianos Dellas is Giourkas's parent,
-- Antonios Nikopolidis is Angelos's, Stelios Giannakopoulos has no child.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.fa441id(n),'synthetic-'||n||'@academy441.invalid',now() FROM unnest(ARRAY[1,2,10,12,20,21,22,30,31,32]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.fa441id(1),'club','Giorgos Karagounis'),(pg_temp.fa441id(2),'club','Angelos Basinas'),
 (pg_temp.fa441id(10),'coach','Otto Rehhagel'),(pg_temp.fa441id(12),'coach','Fernando Santos'),
 (pg_temp.fa441id(20),'player','Giourkas Seitaridis'),(pg_temp.fa441id(21),'player','Angelos Charisteas'),
 (pg_temp.fa441id(22),'player','Kostas Katsouranis'),
 (pg_temp.fa441id(30),'parent','Traianos Dellas'),(pg_temp.fa441id(31),'parent','Antonios Nikopolidis'),
 (pg_temp.fa441id(32),'parent','Stelios Giannakopoulos');
INSERT INTO public.organizations(id,admin_user_id,name,join_code,logo_url) VALUES
 (pg_temp.fa441id(100),pg_temp.fa441id(1),'Panathinaikos Academy','FA441P','https://example.invalid/pao.png'),
 (pg_temp.fa441id(101),pg_temp.fa441id(2),'Aris Academy','FA441A',null);
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.fa441id(10),pg_temp.fa441id(100)),(pg_temp.fa441id(12),pg_temp.fa441id(101));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.fa441id(40),pg_temp.fa441id(10),'Giourkas Seitaridis','U16',pg_temp.fa441id(20)),
 (pg_temp.fa441id(41),pg_temp.fa441id(12),'Angelos Charisteas','U16',pg_temp.fa441id(21)),
 (pg_temp.fa441id(42),pg_temp.fa441id(10),'Kostas Katsouranis','U16',pg_temp.fa441id(22));
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.fa441id(42);
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.fa441id(20),pg_temp.fa441id(30)),(pg_temp.fa441id(21),pg_temp.fa441id(31));

-- ── 1. A family reads its own academy ──────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.fa441actor(20);
SELECT pg_temp.fa441check(pg_temp.fa441read(20) = 'Panathinaikos Academy|https://example.invalid/pao.png','1 a player reads his academy''s name and logo');
SELECT pg_temp.fa441actor(30);
SELECT pg_temp.fa441check(pg_temp.fa441read(20) = 'Panathinaikos Academy|https://example.invalid/pao.png','1 his parent reads the same');
SELECT pg_temp.fa441actor(31);
SELECT pg_temp.fa441check(pg_temp.fa441read(21) = 'Aris Academy|','1 an academy with no logo gives its name and no logo');
SELECT pg_temp.fa441check((SELECT array_agg(parameter_name::text ORDER BY ordinal_position) FROM information_schema.parameters
       WHERE specific_schema='public' AND specific_name LIKE 'family_academy_%' AND parameter_mode='OUT') = ARRAY['name','logo_url'],
  '1 it gives the name and the logo, nothing else');

-- ── 2. And nobody else's ───────────────────────────────────────────────────
SELECT pg_temp.fa441actor(31);
SELECT pg_temp.fa441check(pg_temp.fa441read(20) IS NULL,'2 a parent can''t read another child''s academy');
SELECT pg_temp.fa441actor(21);
SELECT pg_temp.fa441check(pg_temp.fa441read(20) IS NULL,'2 a player can''t read another player''s');
SELECT pg_temp.fa441actor(22);
SELECT pg_temp.fa441check(pg_temp.fa441read(22) IS NULL,'2 a player whose coach left reads none');
SELECT pg_temp.fa441actor(32);
SELECT pg_temp.fa441check(pg_temp.fa441read(20) IS NULL,'2 a parent with no child reads none');
SELECT pg_temp.fa441actor(10);
SELECT pg_temp.fa441check(pg_temp.fa441read(20) IS NULL,'2 a coach reads none through it (Settings reads his)');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.fa441check(pg_temp.fa441refused(format('SELECT * FROM public.family_academy(%L)', pg_temp.fa441id(20)),'42501'),
  '2 anon can''t call it');
RESET ROLE;

-- ── 3. The academy table stays closed to families ──────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.fa441actor(20);
SELECT pg_temp.fa441check(NOT EXISTS(SELECT 1 FROM public.organizations),'3 a player still reads no academy row directly');
SELECT pg_temp.fa441actor(30);
SELECT pg_temp.fa441check(NOT EXISTS(SELECT 1 FROM public.organizations),'3 nor a parent');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.fa441_results;
 IF total <> 12 THEN RAISE EXCEPTION 'Family academy: % checks ran; expected 12', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.fa441_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Family academy checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Family academy: % of % passed', total, total;
END $$;
ROLLBACK;

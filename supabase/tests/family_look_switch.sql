-- @trak-suite mode=--family-look-switch in-all=true
-- TRAK-441: the family app's new look turns on per academy (academy_features 'family_look'). A player of an academy
-- with the row gets it, and so does a parent of a child there; a player or parent elsewhere, a player whose coach
-- left, and a parent of nobody don't. App roles can't switch it. The coach's feature_on is unchanged.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing family-look-switch fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.fl441id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('94410000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE fl441_results(label text, ok boolean);
GRANT SELECT, INSERT ON fl441_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.fl441actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.fl441id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.fl441check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.fl441_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.fl441refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- On Academy (100) has the new look, Off Academy (101) doesn't. Otto Rehhagel coaches at On, Fernando Santos at
-- Off. Players: Giourkas Seitaridis (On), Angelos Charisteas (Off), Kostas Katsouranis (On, coach left).
-- Parents: Traianos Dellas (of Giourkas), Antonios Nikopolidis (of Angelos), Stelios Giannakopoulos (no child).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.fl441id(n),'synthetic-'||n||'@family441.invalid',now() FROM unnest(ARRAY[1,2,10,12,20,21,22,30,31,32]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.fl441id(1),'club','Giorgos Karagounis'),(pg_temp.fl441id(2),'club','Angelos Basinas'),
 (pg_temp.fl441id(10),'coach','Otto Rehhagel'),(pg_temp.fl441id(12),'coach','Fernando Santos'),
 (pg_temp.fl441id(20),'player','Giourkas Seitaridis'),(pg_temp.fl441id(21),'player','Angelos Charisteas'),
 (pg_temp.fl441id(22),'player','Kostas Katsouranis'),
 (pg_temp.fl441id(30),'parent','Traianos Dellas'),(pg_temp.fl441id(31),'parent','Antonios Nikopolidis'),
 (pg_temp.fl441id(32),'parent','Stelios Giannakopoulos');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.fl441id(100),pg_temp.fl441id(1),'Family Look On Academy','F441N1'),
 (pg_temp.fl441id(101),pg_temp.fl441id(2),'Family Look Off Academy','F441F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.fl441id(10),pg_temp.fl441id(100)),(pg_temp.fl441id(12),pg_temp.fl441id(101));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.fl441id(40),pg_temp.fl441id(10),'Giourkas Seitaridis','U16',pg_temp.fl441id(20)),
 (pg_temp.fl441id(41),pg_temp.fl441id(12),'Angelos Charisteas','U16',pg_temp.fl441id(21)),
 (pg_temp.fl441id(42),pg_temp.fl441id(10),'Kostas Katsouranis','U16',pg_temp.fl441id(22));
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.fl441id(42);
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.fl441id(20),pg_temp.fl441id(30)),(pg_temp.fl441id(21),pg_temp.fl441id(31));

-- ── 1. The operator's switch ───────────────────────────────────────────────
SELECT pg_temp.fl441check(pg_temp.fl441refused(format('INSERT INTO public.academy_features(organization_id,feature) VALUES(%L,%L)',
  pg_temp.fl441id(100),'family'),'23514'),'1 a misspelt name is still refused');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.fl441id(100),'family_look');
SELECT pg_temp.fl441check(EXISTS(SELECT 1 FROM public.academy_features WHERE organization_id=pg_temp.fl441id(100) AND feature='family_look'),
  '1 the operator switches the new look on with one row');

-- ── 2. Who gets it ─────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.fl441actor(20);
SELECT pg_temp.fl441check(public.family_feature_on('family_look'),'2 a player of an academy with the switch gets it');
SELECT pg_temp.fl441actor(30);
SELECT pg_temp.fl441check(public.family_feature_on('family_look'),'2 so does a parent of a child there');
SELECT pg_temp.fl441actor(21);
SELECT pg_temp.fl441check(NOT public.family_feature_on('family_look'),'2 a player of another academy doesn''t');
SELECT pg_temp.fl441actor(31);
SELECT pg_temp.fl441check(NOT public.family_feature_on('family_look'),'2 nor a parent of a child there');
SELECT pg_temp.fl441actor(22);
SELECT pg_temp.fl441check(NOT public.family_feature_on('family_look'),'2 nor a player whose coach left');
SELECT pg_temp.fl441actor(32);
SELECT pg_temp.fl441check(NOT public.family_feature_on('family_look'),'2 nor a parent with no child');
SELECT pg_temp.fl441actor(20);
SELECT pg_temp.fl441check(NOT public.family_feature_on('games'),'2 another switch the academy hasn''t got stays off');
SELECT pg_temp.fl441actor(10);
SELECT pg_temp.fl441check(public.feature_on('family_look'),'2 the coach''s feature_on reads the same row');
SELECT pg_temp.fl441check(NOT public.family_feature_on('family_look'),'2 a coach is not a family');

-- ── 3. App roles can't switch it ───────────────────────────────────────────
SELECT pg_temp.fl441actor(30);
SELECT pg_temp.fl441check(pg_temp.fl441refused(format('INSERT INTO public.academy_features(organization_id,feature) VALUES(%L,%L)',
  pg_temp.fl441id(101),'family_look'),'42501'),'3 a parent can''t switch it on');
SELECT pg_temp.fl441actor(10);
SELECT pg_temp.fl441check(pg_temp.fl441refused(format('DELETE FROM public.academy_features WHERE organization_id=%L',
  pg_temp.fl441id(100)),'42501'),'3 a coach can''t switch it off');
RESET ROLE;

-- ── 4. The kill switch ─────────────────────────────────────────────────────
DELETE FROM public.academy_features WHERE organization_id=pg_temp.fl441id(100) AND feature='family_look';
SET LOCAL ROLE authenticated;
SELECT pg_temp.fl441actor(20);
SELECT pg_temp.fl441check(NOT public.family_feature_on('family_look'),'4 deleting the row switches it off at once');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.fl441_results;
 IF total <> 14 THEN RAISE EXCEPTION 'Family look switch: % checks ran; expected 14', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.fl441_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Family look switch checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Family look switch: % of % passed', total, total;
END $$;
ROLLBACK;

-- @trak-suite mode=--child-training-attendance in-all=true
-- TRAK-441 slice 2.5b (Imad, 13 Nov): Season so far's Training tile. child_training_attendance(child) gives a player and
-- their parent "attended / total" on the coach's rules (attendance-rate.ts): trainings only, the child's squad or the
-- whole roster, register taken, on or after the day they joined. Nobody else's, nothing while consent is required,
-- nothing after the coach left, never to anon, and only the two counts.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing child-training-attendance fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.cta(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('94412000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE cta_results(label text, ok boolean);
GRANT SELECT, INSERT ON cta_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.ctaactor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cta(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.ctacheck(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.cta_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.ctarefused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- What the reader gets for a child: "attended/total", or null for no row.
CREATE FUNCTION pg_temp.ctaread(child integer) RETURNS text LANGUAGE sql AS $$
 SELECT attended || '/' || total FROM public.child_training_attendance(pg_temp.cta(child))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Panathinaikos Academy (100): Otto Rehhagel coaches Giourkas Seitaridis (adult, joined 1 Oct 15:00 UTC), Kostas
-- Katsouranis (12, no guardian approval yet) and Traianos Dellas (adult, coach left). Aris Academy (101): Fernando
-- Santos coaches Angelos Charisteas (adult, no training logged). Angelos Basinas is Giourkas's parent, Antonios
-- Nikopolidis is Kostas's, Stelios Giannakopoulos has no child.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.cta(n),'synthetic-'||n||'@attendance441.invalid',now() FROM unnest(ARRAY[1,2,10,12,20,21,22,23,30,31,32]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.cta(1),'club','Giorgos Karagounis'),(pg_temp.cta(2),'club','Vasilios Tsiartas'),
 (pg_temp.cta(10),'coach','Otto Rehhagel'),(pg_temp.cta(12),'coach','Fernando Santos'),
 (pg_temp.cta(20),'player','Giourkas Seitaridis'),(pg_temp.cta(21),'player','Angelos Charisteas'),
 (pg_temp.cta(22),'player','Kostas Katsouranis'),(pg_temp.cta(23),'player','Traianos Dellas'),
 (pg_temp.cta(30),'parent','Angelos Basinas'),(pg_temp.cta(31),'parent','Antonios Nikopolidis'),
 (pg_temp.cta(32),'parent','Stelios Giannakopoulos');
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.cta(20), current_date - interval '20 years'),(pg_temp.cta(21), current_date - interval '20 years'),
 (pg_temp.cta(22), current_date - interval '12 years'),(pg_temp.cta(23), current_date - interval '20 years');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.cta(100),pg_temp.cta(1),'Panathinaikos Academy','CTA441P'),(pg_temp.cta(101),pg_temp.cta(2),'Aris Academy','CTA441A');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.cta(10),pg_temp.cta(100)),(pg_temp.cta(12),pg_temp.cta(101));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,created_at) VALUES
 (pg_temp.cta(40),pg_temp.cta(10),'Giourkas Seitaridis','U16 ',pg_temp.cta(20),'2026-10-01 15:00:00+00'),
 (pg_temp.cta(41),pg_temp.cta(12),'Angelos Charisteas','U16',pg_temp.cta(21),'2026-10-01 00:00:00+00'),
 (pg_temp.cta(42),pg_temp.cta(10),'Kostas Katsouranis','U16',pg_temp.cta(22),'2026-09-01 00:00:00+00'),
 (pg_temp.cta(43),pg_temp.cta(10),'Traianos Dellas','U16',pg_temp.cta(23),'2026-09-01 00:00:00+00'),
 (pg_temp.cta(44),pg_temp.cta(10),'Theofanis Gekas','U18',NULL,'2026-09-01 00:00:00+00');
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.cta(43);
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.cta(20),pg_temp.cta(30)),(pg_temp.cta(22),pg_temp.cta(31));
-- Otto's sessions. Counted for Giourkas: 50 (there), 51 (whole roster, not there), 56 (the day he joined, not there).
-- Not counted: 52 no register, 53 another squad, 54 a match, 55 before he joined.
INSERT INTO public.coach_sessions(id,coach_user_id,session_type,title,session_date,squad) VALUES
 (pg_temp.cta(50),pg_temp.cta(10),'training','Training','2026-10-05','U16'),
 (pg_temp.cta(51),pg_temp.cta(10),'training','Training','2026-10-06',NULL),
 (pg_temp.cta(52),pg_temp.cta(10),'training','Training','2026-10-07','U16'),
 (pg_temp.cta(53),pg_temp.cta(10),'training','Training','2026-10-08','U18'),
 (pg_temp.cta(54),pg_temp.cta(10),'match','Match','2026-10-09','U16'),
 (pg_temp.cta(55),pg_temp.cta(10),'training','Training','2026-09-20','U16'),
 (pg_temp.cta(56),pg_temp.cta(10),'training','Training','2026-10-01','U16');
INSERT INTO public.session_attendance(session_id,squad_player_id,status) VALUES
 (pg_temp.cta(50),pg_temp.cta(40),'present'),(pg_temp.cta(50),pg_temp.cta(43),'present'),
 (pg_temp.cta(51),pg_temp.cta(42),'present'),(pg_temp.cta(53),pg_temp.cta(42),'present'),
 (pg_temp.cta(54),pg_temp.cta(40),'present'),(pg_temp.cta(55),pg_temp.cta(40),'present'),
 (pg_temp.cta(56),pg_temp.cta(42),'present');

-- ── 1. A family reads its own count ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.ctaactor(20);
SELECT pg_temp.ctacheck(pg_temp.ctaread(20) = '1/3','1 a player reads 1 of 3 on the coach''s rules');
SELECT pg_temp.ctaactor(30);
SELECT pg_temp.ctacheck(pg_temp.ctaread(20) = '1/3','1 his parent reads the same');
SELECT pg_temp.ctacheck((SELECT array_agg(parameter_name::text ORDER BY ordinal_position) FROM information_schema.parameters
       WHERE specific_schema='public' AND specific_name LIKE 'child_training_attendance_%' AND parameter_mode='OUT') = ARRAY['attended','total'],
  '1 it gives the two counts, nothing else');
SELECT pg_temp.ctaactor(21);
SELECT pg_temp.ctacheck(pg_temp.ctaread(21) IS NULL,'1 a player with no counted training gets no row, not 0/0');

-- ── 2. And nobody else's ───────────────────────────────────────────────────
SELECT pg_temp.ctaactor(32);
SELECT pg_temp.ctacheck(pg_temp.ctaread(20) IS NULL,'2 a parent can''t read another child''s');
SELECT pg_temp.ctaactor(21);
SELECT pg_temp.ctacheck(pg_temp.ctaread(20) IS NULL,'2 a player can''t read another player''s');
SELECT pg_temp.ctaactor(10);
SELECT pg_temp.ctacheck(pg_temp.ctaread(20) IS NULL,'2 a coach reads none through it');
SELECT pg_temp.ctaactor(22);
SELECT pg_temp.ctacheck(pg_temp.ctaread(22) IS NULL,'2 a child whose consent is required reads none');
SELECT pg_temp.ctaactor(31);
SELECT pg_temp.ctacheck(pg_temp.ctaread(22) IS NULL,'2 nor their parent');
SELECT pg_temp.ctaactor(23);
SELECT pg_temp.ctacheck(pg_temp.ctaread(23) IS NULL,'2 a player whose coach left reads none');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ctacheck(pg_temp.ctarefused(format('SELECT * FROM public.child_training_attendance(%L)', pg_temp.cta(20)),'42501'),
  '2 anon can''t call it');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.cta_results;
 IF total <> 11 THEN RAISE EXCEPTION 'Child training attendance: % checks ran; expected 11', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.cta_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Child training attendance checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Child training attendance: % of % passed', total, total;
END $$;
ROLLBACK;

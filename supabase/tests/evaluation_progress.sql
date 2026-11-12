-- @trak-suite mode=--evaluation-progress in-all=true
-- TRAK-401 (Season plan 18/18 build 6/8, spec TRAK-366): the progress on a published evaluation. The player, and a linked
-- guardian (TRAK-402), read each shared objective's word at that evaluation and the words before it through
-- evaluation_progress(); another child's guardian, a coach, an admin, anon, a player the coach hasn't shared, a withdrawn
-- child and an academy with the switch off read nothing. A removed objective is left out. The evaluation note is the
-- player's alone: it is in coach_shared_feedback, which a guardian cannot read, and nowhere in what this function
-- returns. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing evaluation-progress fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.ev401id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('40100000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE ev401_results(label text, ok boolean);
GRANT SELECT, INSERT ON ev401_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.ev401actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ev401id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.ev401check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.ev401_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.ev401refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.ev401count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
CREATE FUNCTION pg_temp.ev401today() RETURNS date LANGUAGE sql STABLE AS $$
 SELECT (now() AT TIME ZONE 'Asia/Dubai')::date
$$;
-- A squad player's assessment from their n-th evaluation (1 the oldest), read as the owner.
CREATE FUNCTION pg_temp.ev401a(player integer, n integer) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT a.id FROM public.coach_assessments a JOIN public.season_evaluations e ON e.id = a.evaluation_id
 WHERE a.squad_player_id = pg_temp.ev401id(player) ORDER BY e.due_on OFFSET n - 1 LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ev401a(integer, integer) TO authenticated;
-- What actor `who` reads of these assessments (squad player, evaluation) pairs, naming child `child` or nobody.
CREATE FUNCTION pg_temp.ev401read(who integer, picks integer[][], child integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; ids uuid[] := '{}'; i integer;
BEGIN
 FOR i IN 1 .. array_length(picks, 1) LOOP ids := ids || pg_temp.ev401a(picks[i][1], picks[i][2]); END LOOP;
 PERFORM pg_temp.ev401actor(who);
 SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.due_on, f.assessment_id), '[]'::jsonb) INTO r
  FROM public.evaluation_progress(ids, CASE WHEN child IS NULL THEN NULL ELSE pg_temp.ev401id(child) END) f;
 RETURN r;
END $$;
CREATE FUNCTION pg_temp.ev401titles(arr jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(string_agg(e ->> 'title', ',' ORDER BY n), '') FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(e, n)
$$;
CREATE FUNCTION pg_temp.ev401obj(arr jsonb, title text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT e FROM jsonb_array_elements(arr) e WHERE e ->> 'title' = title LIMIT 1
$$;
CREATE FUNCTION pg_temp.ev401obj_id(player integer, title text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT id FROM public.player_objectives WHERE squad_player_id = pg_temp.ev401id(player) AND public.player_objectives.title = ev401obj_id.title
 ORDER BY created_at DESC, id LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ev401obj_id(integer, text) TO authenticated;
CREATE FUNCTION pg_temp.ev401player(n integer, note text DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('squad_player_id', pg_temp.ev401id(n), 'work_rate', 6, 'tactical', 7, 'attitude', 6,
   'technical', 8, 'physical', 5, 'coachability', 6, 'note', note)
$$;
CREATE FUNCTION pg_temp.ev401p(player integer, title text, status text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('player_objective_id', pg_temp.ev401obj_id(player, title), 'status', status)
$$;
CREATE FUNCTION pg_temp.ev401entry(player integer, progress jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('squad_player_id', pg_temp.ev401id(player), 'progress', progress)
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Academy 100 has the season plan. Coach One (10) has the U16 plan (50) with Ola (40, child 20, guardian 30) who has two
-- objectives A and B, Pia (41, child 21, guardian 31) with C, Wes (43, child 24, guardian 34) with W, who will withdraw,
-- and Uma (44, child 25, guardian 35) whose objective U is set up after the first share. Admin 1; guardian 37 has no
-- child here. All children are 14 and every guardian gave consent.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.ev401id(n),'synthetic-'||n||'@evalprogress.invalid',now() FROM unnest(ARRAY[1,10,20,21,24,25,30,31,34,35,37]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.ev401id(1),'club','Synthetic Admin'),(pg_temp.ev401id(10),'coach','Synthetic Coach One'),
 (pg_temp.ev401id(20),'player','Synthetic Player Ola'),(pg_temp.ev401id(21),'player','Synthetic Player Pia'),
 (pg_temp.ev401id(24),'player','Synthetic Player Wes'),(pg_temp.ev401id(25),'player','Synthetic Player Uma'),
 (pg_temp.ev401id(30),'parent','Synthetic Guardian Ola'),(pg_temp.ev401id(31),'parent','Synthetic Guardian Pia'),
 (pg_temp.ev401id(34),'parent','Synthetic Guardian Wes'),(pg_temp.ev401id(35),'parent','Synthetic Guardian Uma'),
 (pg_temp.ev401id(37),'parent','Synthetic Guardian None');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.ev401id(100),pg_temp.ev401id(1),'Evaluation Progress Academy','E401N1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES (pg_temp.ev401id(10),pg_temp.ev401id(100));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.ev401id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,24,25]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.ev401id(20),pg_temp.ev401id(30)),(pg_temp.ev401id(21),pg_temp.ev401id(31)),
 (pg_temp.ev401id(24),pg_temp.ev401id(34)),(pg_temp.ev401id(25),pg_temp.ev401id(35));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.ev401id(40),pg_temp.ev401id(10),'Synthetic Player Ola','U16',pg_temp.ev401id(20),'Attacker'),
 (pg_temp.ev401id(41),pg_temp.ev401id(10),'Synthetic Player Pia','U16',pg_temp.ev401id(21),'Midfielder'),
 (pg_temp.ev401id(43),pg_temp.ev401id(10),'Synthetic Player Wes','U16',pg_temp.ev401id(24),'Attacker'),
 (pg_temp.ev401id(44),pg_temp.ev401id(10),'Synthetic Player Uma','U16',pg_temp.ev401id(25),'Defender');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.ev401id(100),'season_plan');
INSERT INTO public.season_plans(id,coach_user_id,squad,starts_on,ends_on) VALUES
 (pg_temp.ev401id(50),pg_temp.ev401id(10),'U16',pg_temp.ev401today() - 60,pg_temp.ev401today() + 200);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401actor(g), public.record_parental_consent(pg_temp.ev401id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.')
 FROM (VALUES (30,20),(31,21),(34,24),(35,25)) AS consent(g,c);
-- Coach One sets up the objectives, shares the plan, then sets Uma up (still waiting to be shared), and publishes two
-- evaluations: A Not yet then On track, B Not yet then Some progress, C Some progress then Met, W Not yet twice, and U
-- Not yet then Some progress. Ola's first evaluation carries a note.
SELECT pg_temp.ev401actor(10);
SELECT public.save_player_objectives(pg_temp.ev401id(40), '[{"title":"A","source":"own"},{"title":"B","source":"own"}]'::jsonb);
SELECT public.save_player_objectives(pg_temp.ev401id(41), '[{"title":"C","source":"own"}]'::jsonb);
SELECT public.save_player_objectives(pg_temp.ev401id(43), '[{"title":"W","source":"own"}]'::jsonb);
SELECT public.share_season_plan(pg_temp.ev401id(50), true);
SELECT public.save_player_objectives(pg_temp.ev401id(44), '[{"title":"U","source":"own"}]'::jsonb);
SELECT public.publish_evaluation_with_objectives(pg_temp.ev401id(50), pg_temp.ev401today() - 50,
  jsonb_build_array(pg_temp.ev401player(40, 'SECRET-NOTE-FOR-OLA'), pg_temp.ev401player(41), pg_temp.ev401player(43), pg_temp.ev401player(44)),
  jsonb_build_array(pg_temp.ev401entry(40, jsonb_build_array(pg_temp.ev401p(40, 'A', 'not_yet'), pg_temp.ev401p(40, 'B', 'not_yet'))),
    pg_temp.ev401entry(41, jsonb_build_array(pg_temp.ev401p(41, 'C', 'some_progress'))),
    pg_temp.ev401entry(43, jsonb_build_array(pg_temp.ev401p(43, 'W', 'not_yet'))),
    pg_temp.ev401entry(44, jsonb_build_array(pg_temp.ev401p(44, 'U', 'not_yet')))));
SELECT public.publish_evaluation_with_objectives(pg_temp.ev401id(50), pg_temp.ev401today() - 20,
  jsonb_build_array(pg_temp.ev401player(40), pg_temp.ev401player(41), pg_temp.ev401player(43), pg_temp.ev401player(44)),
  jsonb_build_array(pg_temp.ev401entry(40, jsonb_build_array(pg_temp.ev401p(40, 'A', 'on_track'), pg_temp.ev401p(40, 'B', 'some_progress'))),
    pg_temp.ev401entry(41, jsonb_build_array(pg_temp.ev401p(41, 'C', 'met'))),
    pg_temp.ev401entry(43, jsonb_build_array(pg_temp.ev401p(43, 'W', 'not_yet'))),
    pg_temp.ev401entry(44, jsonb_build_array(pg_temp.ev401p(44, 'U', 'some_progress')))));
RESET ROLE;

-- 1. The child reads the progress of an evaluation, with the words before it and none after it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401check(jsonb_array_length(pg_temp.ev401read(20, ARRAY[[40, 2]])) = 1
  AND (pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 ->> 'due_on')::date = pg_temp.ev401today() - 20
  AND pg_temp.ev401titles(pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 -> 'objectives') = 'A,B'
  AND pg_temp.ev401obj(pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 -> 'objectives', 'A') ->> 'status' = 'on_track'
  AND pg_temp.ev401obj(pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 -> 'objectives', 'B') ->> 'status' = 'some_progress'
  AND jsonb_array_length(pg_temp.ev401obj(pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 -> 'objectives', 'A') -> 'history') = 2
  AND pg_temp.ev401obj(pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 -> 'objectives', 'A') -> 'history' -> 0 ->> 'status' = 'not_yet'
  AND pg_temp.ev401obj(pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 -> 'objectives', 'A') -> 'history' -> 1 ->> 'status' = 'on_track',
  '1 the child reads the latest evaluation: its date, each objective''s word and the words before it');
SELECT pg_temp.ev401check((pg_temp.ev401read(20, ARRAY[[40, 1]]) -> 0 ->> 'due_on')::date = pg_temp.ev401today() - 50
  AND pg_temp.ev401obj(pg_temp.ev401read(20, ARRAY[[40, 1]]) -> 0 -> 'objectives', 'A') ->> 'status' = 'not_yet'
  AND jsonb_array_length(pg_temp.ev401obj(pg_temp.ev401read(20, ARRAY[[40, 1]]) -> 0 -> 'objectives', 'A') -> 'history') = 1,
  '1 an earlier evaluation shows its own words and nothing from a later one');
SELECT pg_temp.ev401check(jsonb_array_length(pg_temp.ev401read(20, ARRAY[[40, 1], [40, 2]])) = 2
  AND (pg_temp.ev401read(20, ARRAY[[40, 1], [40, 2]]) -> 0 ->> 'due_on')::date < (pg_temp.ev401read(20, ARRAY[[40, 1], [40, 2]]) -> 1 ->> 'due_on')::date,
  '1 several assessments come back in one read, oldest first');
SELECT pg_temp.ev401check(pg_temp.ev401obj(pg_temp.ev401read(21, ARRAY[[41, 2]]) -> 0 -> 'objectives', 'C') ->> 'status' = 'met',
  '1 a Met objective shows Met at the evaluation that closed it');
RESET ROLE;

-- 2. A linked guardian reads exactly what the child reads, whether or not they name the child.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401check(pg_temp.ev401read(30, ARRAY[[40, 2]]) = pg_temp.ev401read(20, ARRAY[[40, 2]])
  AND pg_temp.ev401read(30, ARRAY[[40, 2]], 20) = pg_temp.ev401read(20, ARRAY[[40, 2]])
  AND pg_temp.ev401read(30, ARRAY[[40, 1], [40, 2]]) = pg_temp.ev401read(20, ARRAY[[40, 1], [40, 2]]),
  '2 a linked guardian reads exactly what the child reads');
RESET ROLE;

-- 3. Nobody else reads it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401check(pg_temp.ev401read(20, ARRAY[[41, 2]]) = '[]'::jsonb AND pg_temp.ev401read(30, ARRAY[[41, 2]]) = '[]'::jsonb
  AND pg_temp.ev401read(31, ARRAY[[40, 2]]) = '[]'::jsonb AND pg_temp.ev401read(31, ARRAY[[40, 2]], 20) = '[]'::jsonb
  AND pg_temp.ev401read(21, ARRAY[[40, 2]], 20) = '[]'::jsonb AND pg_temp.ev401read(37, ARRAY[[40, 2]]) = '[]'::jsonb,
  '3 another child, another child''s guardian and a guardian of nobody read nothing, even naming the child');
SELECT pg_temp.ev401check(jsonb_array_length(pg_temp.ev401read(20, ARRAY[[40, 2], [41, 2]])) = 1,
  '3 asking for two children''s assessments answers only the caller''s own');
SELECT pg_temp.ev401check(pg_temp.ev401read(10, ARRAY[[40, 2]]) = '[]'::jsonb AND pg_temp.ev401read(10, ARRAY[[40, 2]], 20) = '[]'::jsonb
  AND pg_temp.ev401read(1, ARRAY[[40, 2]]) = '[]'::jsonb AND pg_temp.ev401read(1, ARRAY[[40, 2]], 20) = '[]'::jsonb,
  '3 the coach through this function and the academy admin read nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ev401check(pg_temp.ev401refused(format('SELECT * FROM public.evaluation_progress(ARRAY[%L]::uuid[])', pg_temp.ev401a(40, 2)), '42501'),
  '3 anon reads nothing');
RESET ROLE;

-- 4. A player the coach hasn't shared (Uma's objective is still waiting) reads nothing, though it has progress.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401check(pg_temp.ev401read(25, ARRAY[[44, 2]]) = '[]'::jsonb AND pg_temp.ev401read(35, ARRAY[[44, 2]]) = '[]'::jsonb,
  '4 a player whose objectives are still waiting to be shared reads no progress');
RESET ROLE;

-- 5. The note is the player's alone.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401actor(20);
SELECT pg_temp.ev401check(pg_temp.ev401count(format('SELECT count(*) FROM public.coach_shared_feedback WHERE assessment_id = %L AND body = %L',
    pg_temp.ev401a(40, 1), 'SECRET-NOTE-FOR-OLA')) = 1,
  '5 sanity: Ola reads her own note');
SELECT pg_temp.ev401actor(30);
SELECT pg_temp.ev401check(pg_temp.ev401refused('SELECT count(*) FROM public.coach_shared_feedback', '42501')
  OR pg_temp.ev401count('SELECT count(*) FROM public.coach_shared_feedback') = 0,
  '5 her guardian cannot read the note from its table');
SELECT pg_temp.ev401check(pg_temp.ev401read(30, ARRAY[[40, 1], [40, 2]])::text NOT LIKE '%SECRET-NOTE%'
  AND pg_temp.ev401read(20, ARRAY[[40, 1], [40, 2]])::text NOT LIKE '%SECRET-NOTE%'
  AND pg_temp.ev401read(30, ARRAY[[40, 1]]) -> 0 ? 'note' IS FALSE,
  '5 the note is in nothing this function returns, to the player or the guardian');
SELECT pg_temp.ev401check((SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(pg_temp.ev401read(30, ARRAY[[40, 1]]) -> 0) k)
    = ARRAY['assessment_id', 'due_on', 'objectives']
  AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(pg_temp.ev401read(30, ARRAY[[40, 1]]) -> 0 -> 'objectives' -> 0) k)
    = ARRAY['history', 'id', 'status', 'title']
  AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(pg_temp.ev401read(30, ARRAY[[40, 1]]) -> 0 -> 'objectives' -> 0 -> 'history' -> 0) k)
    = ARRAY['due_on', 'status'],
  '5 a row carries the date and each objective''s words, nothing more');
RESET ROLE;

-- 6. A removed objective is left out at once.
UPDATE public.player_objectives SET status = 'retired', retired_at = now() WHERE title = 'B' AND squad_player_id = pg_temp.ev401id(40);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401check(pg_temp.ev401titles(pg_temp.ev401read(20, ARRAY[[40, 2]]) -> 0 -> 'objectives') = 'A'
  AND pg_temp.ev401titles(pg_temp.ev401read(30, ARRAY[[40, 2]]) -> 0 -> 'objectives') = 'A',
  '6 a removed objective is shown to nobody');
RESET ROLE;

-- 7. Consent withdrawn hides it at once; so does the academy switch.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401check(jsonb_array_length(pg_temp.ev401read(24, ARRAY[[43, 2]])) = 1 AND jsonb_array_length(pg_temp.ev401read(34, ARRAY[[43, 2]])) = 1,
  '7 Wes and his guardian read the progress while consent is in place');
SELECT pg_temp.ev401actor(34);
SELECT public.withdraw_parental_consent(pg_temp.ev401id(24));
SELECT pg_temp.ev401check(pg_temp.ev401read(24, ARRAY[[43, 2]]) = '[]'::jsonb AND pg_temp.ev401read(34, ARRAY[[43, 2]]) = '[]'::jsonb
  AND pg_temp.ev401read(34, ARRAY[[43, 2]], 24) = '[]'::jsonb,
  '7 once the guardian withdraws consent, the child and the guardian read nothing');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.ev401id(100) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ev401check(pg_temp.ev401read(20, ARRAY[[40, 2]]) = '[]'::jsonb AND pg_temp.ev401read(30, ARRAY[[40, 2]]) = '[]'::jsonb,
  '7 with the academy''s switch off the child and the guardian read nothing');
RESET ROLE;

-- 8. Privileges: the function is for signed-in users only.
SELECT pg_temp.ev401check(NOT has_function_privilege('anon', 'public.evaluation_progress(uuid[], uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.evaluation_progress(uuid[], uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.evaluation_progress(uuid[], uuid)', 'EXECUTE'),
  '8 only signed-in users may call the read');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.ev401_results;
 IF total <> 19 THEN RAISE EXCEPTION 'Evaluation progress: % checks ran; expected 19', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.ev401_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Evaluation progress checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Evaluation progress: % of % passed', total, total;
END $$;
ROLLBACK;

-- @trak-suite mode=--games-evaluation in-all=true
-- TRAK-288 (Games 6/8, spec TRAK-282): the evaluation, as a draft only the match's coach reads. It opens at full time
-- (the event's end, or 90 minutes after kick-off) and never changes once published. save_game_evaluation is the only
-- write path, and a refused save changes nothing. Scorers and assists are players who played, never more scorers than
-- goals. Rows are written only for consented children on the coach's roster in the match's squad. Saves need the
-- games switch and a match that isn't cancelled. Test people are named after footballers. Synthetic fixtures; rolls
-- back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing games-evaluation fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.g288id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('92880000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE g288_results(label text, ok boolean);
GRANT SELECT, INSERT ON g288_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.g288actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.g288id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.g288check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.g288_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.g288refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- True when the statement runs; the harness prints why when it doesn't.
CREATE FUNCTION pg_temp.g288runs(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE statement; RETURN true;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'g288runs: % (%)', SQLERRM, SQLSTATE; RETURN false;
END $$;
-- A player as the app sends them: the squad row, whether they played, and any answers or note.
CREATE FUNCTION pg_temp.g288p(n integer, played boolean, answers jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id', pg_temp.g288id(n), 'played', played) || answers
$$;
-- One of our goals: who scored and who assisted, null when not recorded.
CREATE FUNCTION pg_temp.g288goal(scorer integer, assist integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('scorer', CASE WHEN scorer IS NOT NULL THEN pg_temp.g288id(scorer) END,
   'assist', CASE WHEN assist IS NOT NULL THEN pg_temp.g288id(assist) END)
$$;
-- A save as the app makes it, as a statement to run.
CREATE FUNCTION pg_temp.g288save(event integer, our integer, their integer, goals jsonb, players jsonb,
  how text DEFAULT '', worked text[] DEFAULT '{}') RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.save_game_evaluation(%L::uuid, %L::integer, %L::integer, %L::jsonb, %L::text, %L::text[], %L::jsonb)',
   pg_temp.g288id(event), our, their, goals, how, worked, players)
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Otto Rehhagel (10) coaches the U16 of an academy with Games; Fernando Santos (11) coaches there too. Otto's roster:
-- Theodoros Zagorakis (40, player A) and Angelos Charisteas (41, player B), consented; Giorgos Karagounis (42), consent
-- pending. Traianos Dellas (30) is player A's guardian. Match 500 was two days ago. 501 kicked off an hour ago (full
-- time in 30 minutes). 503 kicked off 100 minutes ago and its own end is in 20 minutes. 502 was yesterday, cancelled.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.g288id(n),'synthetic-'||n||'@games288.invalid',now() FROM unnest(ARRAY[1,10,11,20,21,22,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.g288id(1),'club','Vassilis Tsiartas'),(pg_temp.g288id(10),'coach','Otto Rehhagel'),(pg_temp.g288id(11),'coach','Fernando Santos'),
 (pg_temp.g288id(20),'player','Theodoros Zagorakis'),(pg_temp.g288id(21),'player','Angelos Charisteas'),
 (pg_temp.g288id(22),'player','Giorgos Karagounis'),(pg_temp.g288id(30),'parent','Traianos Dellas'),(pg_temp.g288id(31),'parent','Michalis Kapsis');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES(pg_temp.g288id(100),pg_temp.g288id(1),'Evaluation Academy','G288N1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES(pg_temp.g288id(10),pg_temp.g288id(100)),(pg_temp.g288id(11),pg_temp.g288id(100));
INSERT INTO public.player_details(user_id,date_of_birth) SELECT pg_temp.g288id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,22]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES(pg_temp.g288id(20),pg_temp.g288id(30)),(pg_temp.g288id(21),pg_temp.g288id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,age_group) VALUES
 (pg_temp.g288id(40),pg_temp.g288id(10),'Theodoros Zagorakis',pg_temp.g288id(20),'U16'),
 (pg_temp.g288id(41),pg_temp.g288id(10),'Angelos Charisteas',pg_temp.g288id(21),'U16'),
 (pg_temp.g288id(42),pg_temp.g288id(10),'Giorgos Karagounis',pg_temp.g288id(22),'U16');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,ends_at,start_time,published,squad,competition) VALUES
 (pg_temp.g288id(500),pg_temp.g288id(10),'vs Portugal','match','Portugal',now() - interval '2 days',NULL,'19:00',true,'U16','tournament'),
 (pg_temp.g288id(501),pg_temp.g288id(10),'vs France','match','France',now() - interval '60 minutes',NULL,'19:00',true,'U16','league'),
 (pg_temp.g288id(503),pg_temp.g288id(10),'vs Czechia','match','Czechia',now() - interval '100 minutes',now() + interval '20 minutes','19:00',true,'U16','friendly'),
 (pg_temp.g288id(502),pg_temp.g288id(10),'vs Spain','match','Spain',now() - interval '1 day',NULL,'19:00',true,'U16',NULL);
UPDATE public.coach_calendar_events SET status='cancelled' WHERE id=pg_temp.g288id(502);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g288id(100),'games');
SET LOCAL ROLE authenticated;
SELECT pg_temp.g288actor(g), public.record_parental_consent(pg_temp.g288id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.') FROM (VALUES (30,20),(31,21)) AS consent(g,c);
RESET ROLE;

-- ── 1. A match carries its competition ─────────────────────────────────────
SELECT pg_temp.g288check((SELECT competition FROM public.coach_calendar_events WHERE id=pg_temp.g288id(500))='tournament',
  '1 a match keeps the competition picked in New event');
SELECT pg_temp.g288check(pg_temp.g288refused(format('UPDATE public.coach_calendar_events SET competition=%L WHERE id=%L','cup',pg_temp.g288id(501)),'23514'),
  '1 a competition that isn''t league, tournament or friendly is refused');

-- ── 2. It opens at full time ───────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g288actor(10);
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(501,1,0,'[]','[]'),'P0001'),
  '2 an hour after kick-off, before full time, the coach can''t start it');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(503,1,0,'[]','[]'),'P0001'),
  '2 an event''s own end counts, not 90 minutes after kick-off');
-- Each save runs in a statement of its own: a subquery beside it would read the table before it ran.
SELECT pg_temp.g288check(pg_temp.g288runs(pg_temp.g288save(500,2,1,jsonb_build_array(pg_temp.g288goal(40)),
    jsonb_build_array(pg_temp.g288p(40,true,'{"note":"  You did your job.  "}'),pg_temp.g288p(41,false)),
    'A set piece and a counter.',ARRAY['worked',NULL])),
  '2 after full time, the coach saves it');
SELECT pg_temp.g288check((SELECT our_score=2 AND their_score=1 AND how_they_scored='A set piece and a counter.' AND plan_worked='{worked,NULL}'
    AND saved_at=now() AND published_at IS NULL FROM public.game_evaluations WHERE event_id=pg_temp.g288id(500)),
  '2 the result, how they scored and did the plan work are kept, as a draft');

-- ── 3. Who played, and only children who can be recorded ───────────────────
SELECT pg_temp.g288check((SELECT array_agg(played ORDER BY squad_player_id) FROM public.game_evaluation_players
    WHERE event_id=pg_temp.g288id(500))='{t,f}',
  '3 player A played and player B didn''t');
SELECT pg_temp.g288check((SELECT did_job='yes' AND against_expectation='met' FROM public.game_evaluation_players
    WHERE event_id=pg_temp.g288id(500) AND squad_player_id=pg_temp.g288id(40)),
  '3 everyone starts at Yes · Met');
SELECT pg_temp.g288check((SELECT note FROM public.game_evaluation_notes WHERE event_id=pg_temp.g288id(500))='You did your job.',
  '3 player A''s note goes in its own table');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,2,1,jsonb_build_array(pg_temp.g288goal(40)),
    jsonb_build_array(pg_temp.g288p(40,true),pg_temp.g288p(42,true))),'42501'),
  '3 no row for a child whose consent is pending');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,2,1,'[]',
    jsonb_build_array(pg_temp.g288p(40,true),pg_temp.g288p(41,false,'{"note":"Next time."}'))),'P0001'),
  '3 a player who didn''t play gets no note');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,2,1,'[]',
    jsonb_build_array(pg_temp.g288p(40,true),pg_temp.g288p(41,false,'{"did_job":"partly"}'))),'23514'),
  '3 nor any answers');

-- ── 4. Scorers: players who played, no more of them than our goals ────────
SELECT pg_temp.g288check((SELECT goals FROM public.game_evaluations WHERE event_id=pg_temp.g288id(500))
    =jsonb_build_array(jsonb_build_object('scorer',pg_temp.g288id(40),'assist',NULL)),
  '4 player A scored, with no assist');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,2,1,
    jsonb_build_array(pg_temp.g288goal(40),pg_temp.g288goal(40),pg_temp.g288goal(NULL)),jsonb_build_array(pg_temp.g288p(40,true))),'23514'),
  '4 three goals recorded in a 2-1 are refused');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,2,1,jsonb_build_array(pg_temp.g288goal(41)),
    jsonb_build_array(pg_temp.g288p(40,true),pg_temp.g288p(41,false))),'P0001'),
  '4 a scorer who didn''t play is refused');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,2,1,jsonb_build_array(pg_temp.g288goal(40,42)),
    jsonb_build_array(pg_temp.g288p(40,true))),'P0001'),
  '4 so is an assist from a child who can''t be recorded');
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,2,1,jsonb_build_array(pg_temp.g288goal(40,40)),
    jsonb_build_array(pg_temp.g288p(40,true))),'23514'),
  '4 nobody assists their own goal');
SELECT pg_temp.g288check((SELECT count(*) FROM public.game_evaluation_players WHERE event_id=pg_temp.g288id(500))=2
  AND (SELECT count(*) FROM public.game_evaluation_notes WHERE event_id=pg_temp.g288id(500))=1
  AND (SELECT jsonb_array_length(goals)=1 FROM public.game_evaluations WHERE event_id=pg_temp.g288id(500)),
  '4 a refused save changes nothing');

-- ── 5. Only the coach reads it, and nobody writes it but the save ─────────
SELECT pg_temp.g288check((SELECT count(*) FROM public.game_evaluations)=1 AND (SELECT count(*) FROM public.game_evaluation_players)=2
  AND (SELECT count(*) FROM public.game_evaluation_notes)=1,
  '5 the coach reads the draft');
SELECT pg_temp.g288check(pg_temp.g288refused(format('UPDATE public.game_evaluations SET published_at=now() WHERE event_id=%L',pg_temp.g288id(500)),'42501')
  AND pg_temp.g288refused(format('INSERT INTO public.game_evaluation_notes(event_id,squad_player_id,note) VALUES(%L,%L,%L)',
    pg_temp.g288id(500),pg_temp.g288id(40),'Brilliant.'),'42501'),
  '5 not even the coach writes the tables directly or marks it published');
SELECT pg_temp.g288actor(11);
SELECT pg_temp.g288check(NOT EXISTS (SELECT 1 FROM public.game_evaluations) AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_players)
  AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_notes)
  AND pg_temp.g288refused(pg_temp.g288save(500,0,0,'[]','[]'),'42501'),
  '5 another coach of the academy reads none and can''t save it');
SELECT pg_temp.g288actor(20);
SELECT pg_temp.g288check(NOT EXISTS (SELECT 1 FROM public.game_evaluations) AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_players)
  AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_notes),
  '5 player A reads none, not even their note');
SELECT pg_temp.g288actor(21);
SELECT pg_temp.g288check(NOT EXISTS (SELECT 1 FROM public.game_evaluation_players),'5 player B reads none');
SELECT pg_temp.g288actor(30);
SELECT pg_temp.g288check(NOT EXISTS (SELECT 1 FROM public.game_evaluations) AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_players)
  AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_notes),
  '5 player A''s guardian reads none');
SELECT pg_temp.g288actor(22);
SELECT pg_temp.g288check(NOT EXISTS (SELECT 1 FROM public.game_evaluation_players),'5 a child whose consent is pending reads none');
SELECT pg_temp.g288actor(1);
SELECT pg_temp.g288check(NOT EXISTS (SELECT 1 FROM public.game_evaluations) AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_notes),
  '5 nor does the academy''s admin');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.g288check(pg_temp.g288refused('SELECT 1 FROM public.game_evaluations','42501'),'5 anon can''t read it at all');
RESET ROLE;

-- ── 6. Cancelled, switched off, published: no save ────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g288actor(10);
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(502,0,0,'[]','[]'),'P0001'),
  '6 a cancelled match has no evaluation');
-- Saving the same players again drops anyone left out: a child who leaves the roster loses their row.
SELECT pg_temp.g288check(pg_temp.g288runs(pg_temp.g288save(500,2,1,jsonb_build_array(pg_temp.g288goal(40)),
    jsonb_build_array(pg_temp.g288p(40,true,'{"did_job":"partly","against_expectation":"above"}')))),
  '6 a later save replaces the draft');
SELECT pg_temp.g288check((SELECT array_agg(did_job || '/' || against_expectation) FROM public.game_evaluation_players
    WHERE event_id=pg_temp.g288id(500))='{partly/above}' AND NOT EXISTS (SELECT 1 FROM public.game_evaluation_notes),
  '6 its answers are kept, and a player left out and a note cleared go');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.g288id(100) AND feature='games';
SET LOCAL ROLE authenticated;
SELECT pg_temp.g288actor(10);
SELECT pg_temp.g288check(EXISTS (SELECT 1 FROM public.game_evaluations)
  AND pg_temp.g288refused(pg_temp.g288save(500,3,1,'[]',jsonb_build_array(pg_temp.g288p(40,true))),'42501'),
  '6 switched off, the coach still reads the draft but can''t save it');
RESET ROLE;
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g288id(100),'games');
-- Published, as TRAK-289 will: it never changes again.
UPDATE public.game_evaluations SET published_at=now() WHERE event_id=pg_temp.g288id(500);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g288actor(10);
SELECT pg_temp.g288check(pg_temp.g288refused(pg_temp.g288save(500,3,1,'[]',jsonb_build_array(pg_temp.g288p(40,true))),'P0001'),
  '6 once published, a save is refused');
SELECT pg_temp.g288check((SELECT our_score FROM public.game_evaluations WHERE event_id=pg_temp.g288id(500))=2,
  '6 and nothing in it changes');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.g288_results;
 IF total <> 33 THEN RAISE EXCEPTION 'Games evaluation: % checks ran; expected 33', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.g288_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Games evaluation checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Games evaluation: % of % passed', total, total;
END $$;
ROLLBACK;

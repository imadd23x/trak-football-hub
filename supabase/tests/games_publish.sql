-- @trak-suite mode=--games-publish in-all=true
-- TRAK-289 (Games 7/8, spec TRAK-282): publishing the evaluation. Before it, players and families read none of it.
-- After it, a player reads their own review (job, did the job, what was asked, against expectation) and their note;
-- a guardian reads their child's review without the note's text; another coach, another child and a child whose
-- consent is pending read nothing. Strength, scouting and how they scored are never copied. Publish refuses until every
-- "Did the plan work?" answer is in and the match has a competition, writes the match log with no rating, and is final.
-- Test people are named after footballers. Synthetic fixtures; rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing games-publish fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.g289id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('92890000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE g289_results(label text, ok boolean);
GRANT SELECT, INSERT ON g289_results TO authenticated, anon, service_role;
-- What publish returned.
CREATE TEMP TABLE g289_out(event integer, result jsonb);
GRANT SELECT, INSERT ON g289_out TO authenticated;
CREATE FUNCTION pg_temp.g289actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.g289id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.g289check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.g289_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.g289refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- True when the statement runs; the harness prints why when it doesn't.
CREATE FUNCTION pg_temp.g289runs(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE statement; RETURN true;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'g289runs: % (%)', SQLERRM, SQLSTATE; RETURN false;
END $$;
CREATE FUNCTION pg_temp.g289publish(event integer, competition text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT format('INSERT INTO pg_temp.g289_out SELECT %s, public.publish_game_evaluation(%L::uuid, %L::text)', event, pg_temp.g289id(event), competition)
$$;
-- What each person reads of match `event`'s review: family rows, player notes, and the coach's working evaluation.
CREATE FUNCTION pg_temp.g289reads(event integer) RETURNS text LANGUAGE sql AS $$
 SELECT format('family %s · notes %s · evaluation %s · plan players %s',
   (SELECT count(*) FROM public.game_review_for_family WHERE event_id = pg_temp.g289id(event)),
   (SELECT count(*) FROM public.game_review_for_player WHERE event_id = pg_temp.g289id(event)),
   (SELECT count(*) FROM public.game_evaluations WHERE event_id = pg_temp.g289id(event)),
   (SELECT count(*) FROM public.game_plan_players WHERE event_id = pg_temp.g289id(event)))
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Otto Rehhagel (10) coaches the U16 of an academy with Games; Fernando Santos (11) coaches there too. Otto's roster:
-- Theodoros Zagorakis (40, player A) and Angelos Charisteas (41, player B), consented; Giorgos Karagounis (42), consent
-- pending. Traianos Dellas (30) is player A's guardian, Michalis Kapsis (31) player B's. Match 500 (league) was two
-- days ago: Zagorakis started out of position and was asked to stretch; Charisteas was on the bench. Match 600 was
-- yesterday, made before New event asked the competition, with no plan.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.g289id(n),'synthetic-'||n||'@games289.invalid',now() FROM unnest(ARRAY[1,10,11,20,21,22,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.g289id(1),'club','Vassilis Tsiartas'),(pg_temp.g289id(10),'coach','Otto Rehhagel'),(pg_temp.g289id(11),'coach','Fernando Santos'),
 (pg_temp.g289id(20),'player','Theodoros Zagorakis'),(pg_temp.g289id(21),'player','Angelos Charisteas'),
 (pg_temp.g289id(22),'player','Giorgos Karagounis'),(pg_temp.g289id(30),'parent','Traianos Dellas'),(pg_temp.g289id(31),'parent','Michalis Kapsis');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES(pg_temp.g289id(100),pg_temp.g289id(1),'Publish Academy','G289N1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES(pg_temp.g289id(10),pg_temp.g289id(100)),(pg_temp.g289id(11),pg_temp.g289id(100));
INSERT INTO public.player_details(user_id,date_of_birth) SELECT pg_temp.g289id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,22]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES(pg_temp.g289id(20),pg_temp.g289id(30)),(pg_temp.g289id(21),pg_temp.g289id(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,age_group,position) VALUES
 (pg_temp.g289id(40),pg_temp.g289id(10),'Theodoros Zagorakis',pg_temp.g289id(20),'U16','Midfielder'),
 (pg_temp.g289id(41),pg_temp.g289id(10),'Angelos Charisteas',pg_temp.g289id(21),'U16','Attacker'),
 (pg_temp.g289id(42),pg_temp.g289id(10),'Giorgos Karagounis',pg_temp.g289id(22),'U16','Midfielder');
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,home_away,starts_at,start_time,published,squad,competition) VALUES
 (pg_temp.g289id(500),pg_temp.g289id(10),'vs Portugal','match','Portugal','away',now() - interval '2 days','19:00',true,'U16','league'),
 (pg_temp.g289id(600),pg_temp.g289id(10),'vs Spain','match','Spain','home',now() - interval '1 day','19:00',true,'U16',NULL);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g289id(100),'games');
-- The plan as it locked at kick-off (written as the operator: the app can't touch it after kick-off).
INSERT INTO public.game_plans(event_id,strength,scouting,goals,formation) VALUES(pg_temp.g289id(500),'stronger','Their 9 is quick.',
 '[{"title":"Win the second ball","looks_like":"First to it."},{"title":"Switch play early","looks_like":""}]','4-4-2');
INSERT INTO public.game_plan_players(event_id,squad_player_id,role,slot,job,note,context,expectation) VALUES
 (pg_temp.g289id(500),pg_temp.g289id(40),'starter',4,'Stay tight to their winger.','Proud of you.','{out_of_position}','stretch'),
 (pg_temp.g289id(500),pg_temp.g289id(41),'bench',NULL,'','','{}','usual');
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(g), public.record_parental_consent(pg_temp.g289id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.') FROM (VALUES (30,20),(31,21)) AS consent(g,c);
-- Otto's draft for 500: 2-1, Zagorakis scored and Charisteas, on as a sub, assisted. One plan answer is missing.
SELECT pg_temp.g289actor(10);
SELECT public.save_game_evaluation(pg_temp.g289id(500), 2, 1,
  jsonb_build_array(jsonb_build_object('scorer',pg_temp.g289id(40),'assist',pg_temp.g289id(41))), 'A corner at the back post.',
  ARRAY['worked',NULL], jsonb_build_array(
    jsonb_build_object('id',pg_temp.g289id(40),'played',true,'did_job','partly','against_expectation','above','note','Brave all game.'),
    jsonb_build_object('id',pg_temp.g289id(41),'played',true)));
SELECT public.save_game_evaluation(pg_temp.g289id(600), 0, 0, '[]', '', '{}',
  jsonb_build_array(jsonb_build_object('id',pg_temp.g289id(40),'played',true),jsonb_build_object('id',pg_temp.g289id(41),'played',true)));
RESET ROLE;

-- ── 1. Before publishing, players and families read none of it ────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(20);
SELECT pg_temp.g289check(pg_temp.g289reads(500) = 'family 0 · notes 0 · evaluation 0 · plan players 0',
  '1 before publishing, player A reads nothing of the evaluation, nor the plan''s expectation and context');
SELECT pg_temp.g289actor(30);
SELECT pg_temp.g289check(pg_temp.g289reads(500) = 'family 0 · notes 0 · evaluation 0 · plan players 0', '1 nor does their guardian');

-- ── 2. Publish waits for the plan answers and the competition ─────────────
SELECT pg_temp.g289actor(11);
SELECT pg_temp.g289check(pg_temp.g289refused(pg_temp.g289publish(500),'42501'), '2 another coach can''t publish it');
SELECT pg_temp.g289actor(10);
SELECT pg_temp.g289check(pg_temp.g289refused(pg_temp.g289publish(500),'P0001'), '2 not with a "Did the plan work?" answer missing');
SELECT public.save_game_evaluation(pg_temp.g289id(500), 2, 1,
  jsonb_build_array(jsonb_build_object('scorer',pg_temp.g289id(40),'assist',pg_temp.g289id(41))), 'A corner at the back post.',
  ARRAY['worked','partly'], jsonb_build_array(
    jsonb_build_object('id',pg_temp.g289id(40),'played',true,'did_job','partly','against_expectation','above','note','Brave all game.'),
    jsonb_build_object('id',pg_temp.g289id(41),'played',true)));
SELECT pg_temp.g289check(pg_temp.g289refused(pg_temp.g289publish(600),'P0001'), '2 not a match with no competition, unless the coach picks one');
SELECT pg_temp.g289check(pg_temp.g289refused(pg_temp.g289publish(600,'cup'),'P0001'), '2 and only league, tournament or friendly');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.g289id(100) AND feature='games';
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(10);
SELECT pg_temp.g289check(pg_temp.g289refused(pg_temp.g289publish(500),'42501'), '2 not with the games switch off');
RESET ROLE;
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g289id(100),'games');

-- ── 3. Publishing ─────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(10);
-- A statement of its own: a subquery beside it would read the tables before it ran.
SELECT pg_temp.g289check(pg_temp.g289runs(pg_temp.g289publish(500)), '3 with every answer in, the coach publishes it');
RESET ROLE;
-- Charisteas leaves the roster before match 600 is published.
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.g289id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(10);
SELECT pg_temp.g289check(pg_temp.g289runs(pg_temp.g289publish(600,'friendly')), '3 a match with no competition publishes once one is picked');
RESET ROLE;
SELECT pg_temp.g289check((SELECT result FROM pg_temp.g289_out WHERE event=600)
    = jsonb_build_object('reviews',1,'logged',1,'skipped',jsonb_build_array(pg_temp.g289id(41)))
  AND NOT EXISTS (SELECT 1 FROM public.game_review_for_family WHERE event_id=pg_temp.g289id(600) AND squad_player_id=pg_temp.g289id(41))
  AND NOT EXISTS (SELECT 1 FROM public.matches WHERE user_id=pg_temp.g289id(21) AND opponent='Spain'),
  '3 a child who left the roster is skipped and named: no review and no match row');
UPDATE public.squad_players SET status='active' WHERE id=pg_temp.g289id(41);
SELECT pg_temp.g289check((SELECT result FROM pg_temp.g289_out WHERE event=500) = jsonb_build_object('reviews',2,'logged',2,'skipped','[]'::jsonb),
  '3 publish says how many got their review and match row');
SELECT pg_temp.g289check((SELECT published_at IS NOT NULL FROM public.game_evaluations WHERE event_id=pg_temp.g289id(500))
  AND (SELECT competition FROM public.coach_calendar_events WHERE id=pg_temp.g289id(600))='friendly',
  '3 it''s marked published, and the picked competition is saved on the match');
SELECT pg_temp.g289check((SELECT count(*) FROM public.event_change_notices WHERE event_id IN (pg_temp.g289id(500),pg_temp.g289id(600)))=0,
  '3 nothing is emailed');

-- ── 4. The match log: the result for each child with an account, no rating ─
SELECT pg_temp.g289check((SELECT string_agg(m.goals || '/' || m.assists || '/' || m.team_score || '-' || m.opponent_score || '/' || m.competition
    || '/' || m.venue || '/' || m.position || '/' || COALESCE(m.computed_rating::text, 'no rating'), ', ' ORDER BY m.goals DESC)
  FROM public.matches m WHERE m.user_id IN (pg_temp.g289id(20),pg_temp.g289id(21)) AND m.opponent='Portugal')
  = '1/0/2-1/League/Away/Midfielder/no rating, 0/1/2-1/League/Away/Attacker/no rating',
  '4 each player''s goals and assists, the score, competition and venue, and no rating');
SELECT pg_temp.g289check((SELECT count(*) FROM public.coach_sessions s WHERE s.event_id=pg_temp.g289id(500) AND s.session_type='match')=1
  AND (SELECT count(*) FROM public.session_attendance a JOIN public.coach_sessions s ON s.id=a.session_id
       WHERE s.event_id=pg_temp.g289id(500) AND a.status='present')=2
  AND (SELECT count(*) FROM public.matches m JOIN public.coach_sessions s ON s.id=m.session_id WHERE s.event_id=pg_temp.g289id(500))=2
  AND (SELECT count(*) FROM public.game_review_for_family f JOIN public.coach_sessions s ON s.id=f.session_id WHERE s.event_id=pg_temp.g289id(500))=2,
  '4 one match session for the event, with who played present, and the match rows and reviews linked to it');

-- ── 5. After publishing: each reads exactly their own ─────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(20);
SELECT pg_temp.g289check((SELECT our_score=2 AND their_score=1 AND job='Stay tight to their winger.' AND did_job='partly'
    AND expectation='stretch' AND context='{out_of_position}' AND against_expectation='above' AND has_note AND coach_name='Otto Rehhagel'
  FROM public.game_review_for_family WHERE event_id=pg_temp.g289id(500) AND squad_player_id=pg_temp.g289id(40))
  AND (SELECT count(*) FROM public.game_review_for_family WHERE event_id=pg_temp.g289id(500))=1,
  '5 player A reads their own review: job, did the job, what was asked, against expectation, and only theirs');
SELECT pg_temp.g289check((SELECT note FROM public.game_review_for_player WHERE event_id=pg_temp.g289id(500))='Brave all game.',
  '5 player A reads their note');
SELECT pg_temp.g289check(pg_temp.g289reads(500) = 'family 1 · notes 1 · evaluation 0 · plan players 0',
  '5 and still nothing of the coach''s working evaluation or plan');
SELECT pg_temp.g289actor(21);
SELECT pg_temp.g289check((SELECT did_job='yes' AND against_expectation='met' AND expectation='usual' AND NOT has_note
  FROM public.game_review_for_family WHERE event_id=pg_temp.g289id(500))
  AND pg_temp.g289reads(500) = 'family 1 · notes 0 · evaluation 0 · plan players 0',
  '5 player B reads their own (Yes · Met, no note), never player A''s');
SELECT pg_temp.g289actor(30);
SELECT pg_temp.g289check((SELECT has_note FROM public.game_review_for_family WHERE event_id=pg_temp.g289id(500)) IS TRUE
  AND pg_temp.g289reads(500) = 'family 1 · notes 0 · evaluation 0 · plan players 0',
  '5 player A''s guardian reads the review, knows there''s a note, and never reads it');
SELECT pg_temp.g289actor(11);
SELECT pg_temp.g289check(pg_temp.g289reads(500) = 'family 0 · notes 0 · evaluation 0 · plan players 0', '5 another coach reads none of it');
SELECT pg_temp.g289actor(22);
SELECT pg_temp.g289check(pg_temp.g289reads(500) = 'family 0 · notes 0 · evaluation 0 · plan players 0', '5 nor does a child whose consent is pending');
RESET ROLE;
SELECT pg_temp.g289check(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name IN ('game_review_for_family','game_review_for_player')
    AND column_name IN ('strength','scouting','how_they_scored','their_formation','key_players','plan_worked')),
  '5 strength, scouting and how they scored are never copied');

-- ── 6. Published is final ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(10);
SELECT pg_temp.g289check(pg_temp.g289refused(pg_temp.g289publish(500),'P0001'), '6 it publishes once');
SELECT pg_temp.g289check(pg_temp.g289refused(format('SELECT public.save_game_evaluation(%L::uuid, 3, 1, %L::jsonb, %L, %L::text[], %L::jsonb)',
    pg_temp.g289id(500), '[]', '', '{worked,partly}', '[]'),'P0001'),
  '6 and its draft can''t change after');
SELECT pg_temp.g289check(pg_temp.g289refused(format('SELECT public.edit_logged_match((SELECT s.id FROM public.coach_sessions s WHERE s.event_id=%L), 3, 1, %L::jsonb)',
    pg_temp.g289id(500), jsonb_build_array(
      jsonb_build_object('user_id',pg_temp.g289id(20),'goals',2,'assists',0,'card','None','computed_rating',9),
      jsonb_build_object('user_id',pg_temp.g289id(21),'goals',0,'assists',1,'card','None','computed_rating',7))),'P0001'),
  '6 nor its result in the match log''s editor, which would give it a rating');
RESET ROLE;
SELECT pg_temp.g289check((SELECT count(*) FROM public.matches WHERE opponent='Portugal' AND computed_rating IS NULL AND team_score=2)=2,
  '6 so the match rows keep the published result and no rating');
SET LOCAL ROLE authenticated;
SELECT pg_temp.g289actor(10);
SELECT pg_temp.g289check(pg_temp.g289refused(format('INSERT INTO public.game_review_for_player(event_id,squad_player_id,note) VALUES(%L,%L,%L)',
    pg_temp.g289id(500),pg_temp.g289id(41),'Hi.'),'42501'),
  '6 nobody writes a review copy directly');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.g289_results;
 IF total <> 28 THEN RAISE EXCEPTION 'Games publish: % checks ran; expected 28', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.g289_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Games publish checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Games publish: % of % passed', total, total;
END $$;
ROLLBACK;

-- @trak-suite mode=--objective-progress in-all=true
-- TRAK-365 (Season plan 17/18, spec TRAK-348): objectives in the evaluation. An evaluation says how each open
-- objective of a published player is going (Not yet, Some progress, On track or Met), through
-- publish_evaluation_with_objectives() only, with the ratings, in one go: a refusal anywhere writes nothing. Met
-- closes the objective and frees its place for an added one, and a player keeps at most two open. An objective with
-- three Not yets in a row is stuck, and only then resolve_stuck_objective() takes Make it simpler, Keep going or Swap
-- it, recording each; it is stuck again only after three more. Only the player's coach reads progress and choices:
-- other coaches, players and anon read nothing, and nobody writes them directly. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing objective-progress fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.ob365id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('93650000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE ob365_results(label text, ok boolean);
GRANT SELECT, INSERT ON ob365_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.ob365actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ob365id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.ob365check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.ob365_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.ob365refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.ob365count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
CREATE FUNCTION pg_temp.ob365today() RETURNS date LANGUAGE sql STABLE AS $$
 SELECT (now() AT TIME ZONE 'Asia/Dubai')::date
$$;
-- An objective's id by player and title, read as the owner.
CREATE FUNCTION pg_temp.ob365obj(player integer, title text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT id FROM public.player_objectives WHERE squad_player_id = pg_temp.ob365id(player) AND public.player_objectives.title = ob365obj.title
 ORDER BY created_at DESC, id LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ob365obj(integer, text) TO authenticated;
CREATE FUNCTION pg_temp.ob365player(n integer) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('squad_player_id', pg_temp.ob365id(n), 'work_rate', 6, 'tactical', 7, 'attitude', 6,
   'technical', 8, 'physical', 5, 'coachability', 6)
$$;
CREATE FUNCTION pg_temp.ob365p(player integer, title text, status text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('player_objective_id', pg_temp.ob365obj(player, title), 'status', status)
$$;
-- One player's entry in the objectives list.
CREATE FUNCTION pg_temp.ob365entry(player integer, progress jsonb, add jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('squad_player_id', pg_temp.ob365id(player), 'progress', progress, 'add', add)
$$;
CREATE FUNCTION pg_temp.ob365publish(plan integer, due date, players jsonb, objectives jsonb) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT format('SELECT public.publish_evaluation_with_objectives(%L, %L, %L::jsonb, %L::jsonb)', pg_temp.ob365id(plan), due, players, objectives)
$$;
CREATE FUNCTION pg_temp.ob365resolve(player integer, title text, choice text, easier text DEFAULT NULL) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT format('SELECT public.resolve_stuck_objective(%L, %L, %L)', pg_temp.ob365obj(player, title), choice, easier)
$$;
-- What exists, read as the owner: nothing changes when a publish is refused.
CREATE FUNCTION pg_temp.ob365written() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
 SELECT (SELECT count(*) FROM public.season_evaluations)::text || '/' || (SELECT count(*) FROM public.objective_progress)::text || '/' ||
   (SELECT count(*) FROM public.player_objectives)::text
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ob365written() TO authenticated;
CREATE TEMP TABLE ob365_before(written text);
GRANT SELECT, INSERT ON ob365_before TO authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Academy (100) has the season plan. Coach One (10): U16 players Ola (40, Attacker), Pia (41, Midfielder) and Nia (42, no
-- position); Coach Two (11): Rae (43, Attacker). Plans: Coach One's U16 (50) and Coach Two's U16 (51), shared a month
-- ago, each running from 60 days ago to 200 days ahead.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.ob365id(n),'synthetic-'||n||'@objective365.invalid',now() FROM unnest(ARRAY[1,10,11,20,21,22,23]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.ob365id(1),'club','Synthetic Admin'),
 (pg_temp.ob365id(10),'coach','Synthetic Coach One'),(pg_temp.ob365id(11),'coach','Synthetic Coach Two'),
 (pg_temp.ob365id(20),'player','Synthetic Player Ola'),(pg_temp.ob365id(21),'player','Synthetic Player Pia'),
 (pg_temp.ob365id(22),'player','Synthetic Player Rae'),(pg_temp.ob365id(23),'player','Synthetic Player Nia');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES (pg_temp.ob365id(100),pg_temp.ob365id(1),'Objective Progress Academy','O365N1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES (pg_temp.ob365id(10),pg_temp.ob365id(100)),(pg_temp.ob365id(11),pg_temp.ob365id(100));
INSERT INTO public.player_details(user_id,date_of_birth) SELECT pg_temp.ob365id(n), current_date - interval '20 years' FROM unnest(ARRAY[20,21,22,23]) n;
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.ob365id(40),pg_temp.ob365id(10),'Synthetic Player Ola','U16',pg_temp.ob365id(20),'Attacker'),
 (pg_temp.ob365id(41),pg_temp.ob365id(10),'Synthetic Player Pia','U16',pg_temp.ob365id(21),'Midfielder'),
 (pg_temp.ob365id(42),pg_temp.ob365id(10),'Synthetic Player Nia','U16',pg_temp.ob365id(23),NULL),
 (pg_temp.ob365id(43),pg_temp.ob365id(11),'Synthetic Player Rae','U16',pg_temp.ob365id(22),'Attacker');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.ob365id(100),'season_plan');
INSERT INTO public.season_plans(id,coach_user_id,squad,starts_on,ends_on) VALUES
 (pg_temp.ob365id(50),pg_temp.ob365id(10),'U16',pg_temp.ob365today() - 60,pg_temp.ob365today() + 200),
 (pg_temp.ob365id(51),pg_temp.ob365id(11),'U16',pg_temp.ob365today() - 60,pg_temp.ob365today() + 200);
UPDATE public.season_plans SET shared_at = now() - interval '30 days', last_shared_at = now() - interval '30 days'
 WHERE id IN (pg_temp.ob365id(50), pg_temp.ob365id(51));
-- Objectives, as the coach saves them: Ola A and B, Pia C, Rae R.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ob365actor(10);
SELECT public.save_player_objectives(pg_temp.ob365id(40), '[{"title":"A","source":"own"},{"title":"B","source":"own"}]'::jsonb);
SELECT public.save_player_objectives(pg_temp.ob365id(41), '[{"title":"C","source":"own"}]'::jsonb);
SELECT pg_temp.ob365actor(11);
SELECT public.save_player_objectives(pg_temp.ob365id(43), '[{"title":"R","source":"own"}]'::jsonb);
RESET ROLE;

-- 1. Nobody writes progress or choices directly, and only the player's coach reads them.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ob365actor(10);
SELECT pg_temp.ob365check(pg_temp.ob365refused(format('INSERT INTO public.objective_progress(evaluation_id, player_objective_id, status) VALUES(%L, %L, ''met'')',
  pg_temp.ob365id(1), pg_temp.ob365obj(40, 'A')), '42501')
  AND pg_temp.ob365refused(format('UPDATE public.objective_progress SET status = ''met'''), '42501')
  AND pg_temp.ob365refused('DELETE FROM public.objective_progress', '42501'),
  '1 the coach never writes or deletes progress');
SELECT pg_temp.ob365check(pg_temp.ob365refused(format('INSERT INTO public.objective_stuck_choices(player_objective_id, after_evaluation_id, choice) VALUES(%L, %L, ''swap'')',
  pg_temp.ob365obj(40, 'A'), pg_temp.ob365id(1)), '42501')
  AND pg_temp.ob365refused('UPDATE public.objective_stuck_choices SET choice = ''swap''', '42501')
  AND pg_temp.ob365refused('DELETE FROM public.objective_stuck_choices', '42501'),
  '1 nor the choices for a stuck objective');
SELECT pg_temp.ob365check(pg_temp.ob365refused(format('UPDATE public.player_objectives SET status = ''met'', retired_at = now() WHERE id = %L',
  pg_temp.ob365obj(40, 'A')), '42501'), '1 Met comes only with an evaluation: the coach can''t set it');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ob365check(pg_temp.ob365refused('SELECT count(*) FROM public.objective_progress', '42501')
  AND pg_temp.ob365refused('SELECT count(*) FROM public.objective_stuck_choices', '42501')
  AND pg_temp.ob365refused('SELECT * FROM public.stuck_player_objectives()', '42501')
  AND pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)), '[]'), '42501'),
  '1 anon reads and writes nothing');
RESET ROLE;

-- 2. A publish that is refused writes nothing: the ratings, the progress and the added objectives all wait.
INSERT INTO pg_temp.ob365_before SELECT pg_temp.ob365written();
SET LOCAL ROLE authenticated;
SELECT pg_temp.ob365actor(10);
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'))))), '22023'),
  '2 every open objective of a published player gets a status: B is missing');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'great'))))), '22023'),
  '2 only Not yet, Some progress, On track or Met');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'A', 'on_track'),
    pg_temp.ob365p(40, 'B', 'not_yet'))))), '22023'),
  '2 each objective once');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(41, 'C', 'not_yet'))))), '22023'),
  '2 another player''s objective isn''t this player''s to rate');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'not_yet'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'C', 'not_yet'))))), '22023'),
  '2 objectives only for players in the evaluation');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'not_yet')), '["C"]'))), '22023'),
  '2 a third open objective is refused');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50,
  jsonb_build_array(pg_temp.ob365player(40), (pg_temp.ob365player(42))),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'not_yet'))),
    pg_temp.ob365entry(42, '[]', '["X"]'))), '22023'),
  '2 no position, no objective');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50,
  jsonb_build_array(pg_temp.ob365player(40), pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'not_yet'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'C', 'met')), '[5]'))), '22023')
  AND pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'C', 'met')), '["  padded "]'))), '22023'),
  '2 an added objective is one trimmed line of text');
RESET ROLE;
SELECT pg_temp.ob365check(pg_temp.ob365written() = (SELECT written FROM pg_temp.ob365_before),
  '2 after all those refusals nothing was written: no evaluation, no progress, no objective');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ob365actor(11);
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'not_yet'))))), '42501'),
  '2 another coach can''t publish a squad''s evaluation');
SELECT pg_temp.ob365actor(20);
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365publish(50, pg_temp.ob365today() - 50, jsonb_build_array(pg_temp.ob365player(40)), '[]'), '42501')
  AND pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'keep_going'), '42501'),
  '2 nor can a player');
RESET ROLE;

-- 3. Three evaluations: A stays Not yet, B goes Not yet, Some progress, Not yet; Pia's C is Some progress, Not yet, Met.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ob365actor(10);
SELECT public.publish_evaluation_with_objectives(pg_temp.ob365id(50), pg_temp.ob365today() - 50,
  jsonb_build_array(pg_temp.ob365player(40), pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'not_yet'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'C', 'some_progress')))));
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.objective_progress') = 3
  AND pg_temp.ob365count('SELECT count(*) FROM public.season_evaluations') = 1,
  '3 the first evaluation writes its ratings and one status per open objective');
SELECT public.publish_evaluation_with_objectives(pg_temp.ob365id(50), pg_temp.ob365today() - 30,
  jsonb_build_array(pg_temp.ob365player(40), pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'some_progress'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'C', 'not_yet')))));
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 0,
  '3 two Not yets in a row aren''t stuck');
-- Met closes C and frees its place; D and E are added into the two free places in the same evaluation.
SELECT public.publish_evaluation_with_objectives(pg_temp.ob365id(50), pg_temp.ob365today() - 10,
  jsonb_build_array(pg_temp.ob365player(40), pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'not_yet'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'C', 'met')), '["D", "E"]')));
SELECT pg_temp.ob365check(pg_temp.ob365count(format('SELECT count(*) FROM public.player_objectives WHERE id = %L AND status = ''met'' AND retired_at IS NOT NULL',
  pg_temp.ob365obj(41, 'C'))) = 1, '3 Met closes the objective and keeps it');
SELECT pg_temp.ob365check(pg_temp.ob365count(format(
  'SELECT count(*) FROM public.player_objectives WHERE squad_player_id = %L AND status = ''open'' AND source = ''own'' AND slot IN (1, 2)', pg_temp.ob365id(41))) = 2
  AND pg_temp.ob365count(format('SELECT count(DISTINCT slot) FROM public.player_objectives WHERE squad_player_id = %L AND status = ''open''', pg_temp.ob365id(41))) = 2,
  '3 the freed place takes an added objective, up to two open');
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 1
  AND pg_temp.ob365count(format('SELECT count(*) FROM public.stuck_player_objectives() WHERE player_objective_id = %L', pg_temp.ob365obj(40, 'A'))) = 1,
  '3 three Not yets in a row make A stuck; B (Not yet, Some progress, Not yet) and the met C are not');
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.objective_progress') = 9,'3 the coach reads every status of their players');
SELECT pg_temp.ob365actor(11);
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.objective_progress') = 0
  AND pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 0,
  '3 another coach reads and sees nothing of them');
SELECT pg_temp.ob365actor(20);
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.objective_progress') = 0
  AND pg_temp.ob365count('SELECT count(*) FROM public.objective_stuck_choices') = 0
  AND pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 0,
  '3 a player sees none of it yet (TRAK-366)');
RESET ROLE;

-- 4. Only a stuck objective takes a choice, and only its coach.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ob365actor(10);
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365resolve(40, 'B', 'keep_going'), 'P0001')
  AND pg_temp.ob365refused(pg_temp.ob365resolve(41, 'C', 'swap'), 'P0001'),
  '4 an objective that isn''t stuck, or is met, takes no choice');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'later'), '22023')
  AND pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'simpler'), '22023')
  AND pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'simpler', 'A'), '22023')
  AND pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'simpler', ' B'), '22023')
  AND pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'simpler', 'B'), '22023'),
  '4 Make it simpler needs an easier version, one trimmed line, not the same and not one already open');
SELECT pg_temp.ob365actor(11);
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'keep_going'), '42501'),
  '4 another coach can''t choose for it');
RESET ROLE;
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.objective_stuck_choices') = 0, '4 and none of that recorded a choice');

-- 5. Keep going records the choice; A is stuck again only after three more Not yets in a row.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ob365actor(10);
SELECT public.resolve_stuck_objective(pg_temp.ob365obj(40, 'A'), 'keep_going');
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 0
  AND pg_temp.ob365count(format('SELECT count(*) FROM public.objective_stuck_choices WHERE player_objective_id = %L AND choice = ''keep_going''', pg_temp.ob365obj(40, 'A'))) = 1,
  '5 Keep going records the choice and the card goes');
SELECT pg_temp.ob365check(pg_temp.ob365refused(pg_temp.ob365resolve(40, 'A', 'keep_going'), 'P0001'), '5 it isn''t stuck again straight away');
SELECT public.publish_evaluation_with_objectives(pg_temp.ob365id(50), pg_temp.ob365today() - 5,
  jsonb_build_array(pg_temp.ob365player(40), pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'on_track'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'D', 'not_yet'), pg_temp.ob365p(41, 'E', 'not_yet')))));
SELECT public.publish_evaluation_with_objectives(pg_temp.ob365id(50), pg_temp.ob365today() - 3,
  jsonb_build_array(pg_temp.ob365player(40), pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'on_track'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'D', 'not_yet'), pg_temp.ob365p(41, 'E', 'not_yet')))));
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 0,
  '5 two more Not yets after the choice aren''t stuck');
SELECT public.publish_evaluation_with_objectives(pg_temp.ob365id(50), pg_temp.ob365today() - 1,
  jsonb_build_array(pg_temp.ob365player(40), pg_temp.ob365player(41)),
  jsonb_build_array(pg_temp.ob365entry(40, jsonb_build_array(pg_temp.ob365p(40, 'A', 'not_yet'), pg_temp.ob365p(40, 'B', 'on_track'))),
    pg_temp.ob365entry(41, jsonb_build_array(pg_temp.ob365p(41, 'D', 'not_yet'), pg_temp.ob365p(41, 'E', 'not_yet')))));
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 3,
  '5 three more make A stuck again, and D and E stuck for the first time');

-- 6. Make it simpler replaces D with an easier version in the same place; Swap it retires E and frees the place.
SELECT public.resolve_stuck_objective(pg_temp.ob365obj(41, 'D'), 'simpler', 'D but easier');
SELECT pg_temp.ob365check(pg_temp.ob365count(format('SELECT count(*) FROM public.player_objectives WHERE id = %L AND status = ''retired'' AND retired_at IS NOT NULL',
  pg_temp.ob365obj(41, 'D'))) = 1
  AND pg_temp.ob365count(format('SELECT count(*) FROM public.player_objectives n JOIN public.objective_stuck_choices c ON c.new_objective_id = n.id
    WHERE n.title = ''D but easier'' AND n.status = ''open'' AND n.source = ''own'' AND c.choice = ''simpler'' AND c.player_objective_id = %L',
    pg_temp.ob365obj(41, 'D'))) = 1
  AND pg_temp.ob365count(format('SELECT count(*) FROM public.player_objectives o JOIN public.player_objectives n ON n.squad_player_id = o.squad_player_id AND n.slot = o.slot
    WHERE o.id = %L AND n.title = ''D but easier'' AND n.status = ''open''', pg_temp.ob365obj(41, 'D'))) = 1,
  '6 Make it simpler retires the old objective, opens the easier one in its place, and records the choice');
SELECT public.resolve_stuck_objective(pg_temp.ob365obj(41, 'E'), 'swap');
SELECT pg_temp.ob365check(pg_temp.ob365count(format('SELECT count(*) FROM public.player_objectives WHERE id = %L AND status = ''retired''', pg_temp.ob365obj(41, 'E'))) = 1
  AND pg_temp.ob365count(format('SELECT count(*) FROM public.player_objectives WHERE squad_player_id = %L AND status = ''open''', pg_temp.ob365id(41))) = 1
  AND pg_temp.ob365count(format('SELECT count(*) FROM public.objective_stuck_choices WHERE player_objective_id = %L AND choice = ''swap'' AND new_objective_id IS NULL',
    pg_temp.ob365obj(41, 'E'))) = 1,
  '6 Swap it retires the objective, records the choice and frees the place');
SELECT public.resolve_stuck_objective(pg_temp.ob365obj(40, 'A'), 'keep_going');
SELECT pg_temp.ob365check(pg_temp.ob365count('SELECT count(*) FROM public.stuck_player_objectives()') = 0
  AND pg_temp.ob365count(format('SELECT count(*) FROM public.objective_stuck_choices WHERE player_objective_id = %L', pg_temp.ob365obj(40, 'A'))) = 2,
  '6 each choice is kept: A has two, and nothing is stuck now');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.ob365_results;
 IF total <> 34 THEN RAISE EXCEPTION 'Objective progress: % checks ran; expected 34', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.ob365_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Objective progress checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Objective progress: % of % passed', total, total;
END $$;
ROLLBACK;

-- @trak-suite mode=--season-plan-reads in-all=true
-- TRAK-396 (Season plan 18/18 build 1/8, spec TRAK-366): what players and guardians read of the season plan. They read
-- what the coach last SHARED through season_plan_for_player(), never the working copy: the child and a linked guardian
-- get exactly the same words; another child's guardian, another coach, an admin, anon, a player the coach hasn't shared,
-- a child whose consent is withdrawn and an academy with the season_plan switch off get nothing. Unshared edits stay
-- hidden until Share (a removal hides at once), a published evaluation is read as published, "New" is private to each
-- reader, and the evaluation note is nowhere in what comes back. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing season-plan-read fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.sp396id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('39600000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE sp396_results(label text, ok boolean);
GRANT SELECT, INSERT ON sp396_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.sp396actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.sp396id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.sp396check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.sp396_results VALUES(label, ok IS TRUE)
$$;
CREATE FUNCTION pg_temp.sp396refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.sp396count(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 EXECUTE statement INTO n; RETURN n;
END $$;
CREATE FUNCTION pg_temp.sp396today() RETURNS date LANGUAGE sql STABLE AS $$
 SELECT (now() AT TIME ZONE 'Asia/Dubai')::date
$$;
-- What actor `who` reads of child `child` (everyone they may read when null), one object per row.
CREATE FUNCTION pg_temp.sp396read(who integer, child integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 PERFORM pg_temp.sp396actor(who);
 SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) INTO r
  FROM public.season_plan_for_player(CASE WHEN child IS NULL THEN NULL ELSE pg_temp.sp396id(child) END) f;
 RETURN r;
END $$;
-- The titles in a list of objectives, in order.
CREATE FUNCTION pg_temp.sp396titles(arr jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(string_agg(e ->> 'title', ',' ORDER BY n), '') FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(e, n)
$$;
-- One objective of a squad player, by title, in what they read.
CREATE FUNCTION pg_temp.sp396obj(arr jsonb, title text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT e FROM jsonb_array_elements(arr) e WHERE e ->> 'title' = title LIMIT 1
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Academy 100 has the season plan, academy 101 does not. Coach One (10, academy 100) has the U16 plan (50) with players
-- Ola (40, child 20, Attacker, guardian 30), Pia (41, child 21, guardian 31), Nia (42, child 23, guardian 33) who has no
-- objectives, Wes (43, child 24, guardian 34) who will withdraw, and Uma (44, child 25, guardian 35) who is set up after
-- the first share. Coach Two (11) has a draft plan (51) and Rae (45, child 22, guardian 32). Coach Three (12, academy 101)
-- shared plan 52 while the switch was on, and Zed (46, child 26, guardian 36) has an objective. Guardian 37 has no child
-- here. All children are 14 and every guardian gave consent.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.sp396id(n),'synthetic-'||n||'@seasonreads.invalid',now() FROM unnest(ARRAY[1,2,10,11,12,20,21,22,23,24,25,26,30,31,32,33,34,35,36,37]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.sp396id(1),'club','Synthetic Admin'),(pg_temp.sp396id(2),'club','Synthetic Admin Two'),
 (pg_temp.sp396id(10),'coach','Synthetic Coach One'),(pg_temp.sp396id(11),'coach','Synthetic Coach Two'),
 (pg_temp.sp396id(12),'coach','Synthetic Coach Three'),
 (pg_temp.sp396id(20),'player','Synthetic Player Ola'),(pg_temp.sp396id(21),'player','Synthetic Player Pia'),
 (pg_temp.sp396id(22),'player','Synthetic Player Rae'),(pg_temp.sp396id(23),'player','Synthetic Player Nia'),
 (pg_temp.sp396id(24),'player','Synthetic Player Wes'),(pg_temp.sp396id(25),'player','Synthetic Player Uma'),
 (pg_temp.sp396id(26),'player','Synthetic Player Zed'),
 (pg_temp.sp396id(30),'parent','Synthetic Guardian Ola'),(pg_temp.sp396id(31),'parent','Synthetic Guardian Pia'),
 (pg_temp.sp396id(32),'parent','Synthetic Guardian Rae'),(pg_temp.sp396id(33),'parent','Synthetic Guardian Nia'),
 (pg_temp.sp396id(34),'parent','Synthetic Guardian Wes'),(pg_temp.sp396id(35),'parent','Synthetic Guardian Uma'),
 (pg_temp.sp396id(36),'parent','Synthetic Guardian Zed'),(pg_temp.sp396id(37),'parent','Synthetic Guardian None');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.sp396id(100),pg_temp.sp396id(1),'Season Reads Academy','S396N1'),
 (pg_temp.sp396id(101),pg_temp.sp396id(2),'Season Reads Off Academy','S396F1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.sp396id(10),pg_temp.sp396id(100)),(pg_temp.sp396id(11),pg_temp.sp396id(100)),(pg_temp.sp396id(12),pg_temp.sp396id(101));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.sp396id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,22,23,24,25,26]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.sp396id(20),pg_temp.sp396id(30)),(pg_temp.sp396id(21),pg_temp.sp396id(31)),(pg_temp.sp396id(22),pg_temp.sp396id(32)),
 (pg_temp.sp396id(23),pg_temp.sp396id(33)),(pg_temp.sp396id(24),pg_temp.sp396id(34)),(pg_temp.sp396id(25),pg_temp.sp396id(35)),
 (pg_temp.sp396id(26),pg_temp.sp396id(36));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id,position) VALUES
 (pg_temp.sp396id(40),pg_temp.sp396id(10),'Synthetic Player Ola','U16',pg_temp.sp396id(20),'Attacker'),
 (pg_temp.sp396id(41),pg_temp.sp396id(10),'Synthetic Player Pia','U16',pg_temp.sp396id(21),'Midfielder'),
 (pg_temp.sp396id(42),pg_temp.sp396id(10),'Synthetic Player Nia','U16',pg_temp.sp396id(23),'Defender'),
 (pg_temp.sp396id(43),pg_temp.sp396id(10),'Synthetic Player Wes','U16',pg_temp.sp396id(24),'Attacker'),
 (pg_temp.sp396id(44),pg_temp.sp396id(10),'Synthetic Player Uma','U16',pg_temp.sp396id(25),'Defender'),
 (pg_temp.sp396id(45),pg_temp.sp396id(11),'Synthetic Player Rae','U16',pg_temp.sp396id(22),'Attacker'),
 (pg_temp.sp396id(46),pg_temp.sp396id(12),'Synthetic Player Zed','U16',pg_temp.sp396id(26),'Attacker');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.sp396id(100),'season_plan');
INSERT INTO public.season_plans(id,coach_user_id,squad,starts_on,ends_on) VALUES
 (pg_temp.sp396id(50),pg_temp.sp396id(10),'U16',pg_temp.sp396today() - 60,pg_temp.sp396today() + 200),
 (pg_temp.sp396id(51),pg_temp.sp396id(11),'U16',pg_temp.sp396today() - 60,pg_temp.sp396today() + 200);
-- Coach Three's plan, shared back when the switch was on, as Share leaves it.
INSERT INTO public.season_plans(id,coach_user_id,squad,starts_on,ends_on,shared_at,last_shared_at,
  shared_starts_on,shared_ends_on,shared_eval_every,shared_eval_day) VALUES
 (pg_temp.sp396id(52),pg_temp.sp396id(12),'U16',pg_temp.sp396today() - 60,pg_temp.sp396today() + 200,now(),now(),
  pg_temp.sp396today() - 60,pg_temp.sp396today() + 200,'month',0);
INSERT INTO public.player_objectives(squad_player_id,slot,title,source,shared_at)
 VALUES(pg_temp.sp396id(46),1,'Z','own',now());
-- Every guardian gives consent, as in the other suites.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396actor(g), public.record_parental_consent(pg_temp.sp396id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.')
 FROM (VALUES (30,20),(31,21),(32,22),(33,23),(34,24),(35,25),(36,26)) AS consent(g,c);
-- Coach One sets up the season as the coach does: two season objectives, and objectives, a position, Can also play and
-- a role for Ola, Pia and Wes. Nia, Rae and Uma have none yet.
SELECT pg_temp.sp396actor(10);
INSERT INTO public.season_objectives(plan_id,place,title,looks_like) VALUES
 (pg_temp.sp396id(50),1,'Press high','Win it back in five seconds'),(pg_temp.sp396id(50),2,'Stay compact','Ten metres between lines');
SELECT public.save_player_objectives(pg_temp.sp396id(40), '[{"title":"A","source":"own"},{"title":"B","source":"own"}]'::jsonb);
SELECT public.save_player_objectives(pg_temp.sp396id(41), '[{"title":"C","source":"own"}]'::jsonb);
SELECT public.save_player_objectives(pg_temp.sp396id(43), '[{"title":"W","source":"own"}]'::jsonb);
SELECT public.save_player_position_and_roles(pg_temp.sp396id(40), 'Attacker', ARRAY['Midfielder'], ARRAY['Pressing forward']);
RESET ROLE;

-- 1. Before the first Share nobody reads anything: the plan is a draft, with its objectives.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(pg_temp.sp396read(20) = '[]'::jsonb AND pg_temp.sp396read(30) = '[]'::jsonb
  AND pg_temp.sp396read(30, 20) = '[]'::jsonb AND pg_temp.sp396read(31) = '[]'::jsonb,
  '1 before Share the child and their guardian read nothing');
RESET ROLE;

-- Coach One shares the plan, face to face first.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396actor(10);
SELECT public.share_season_plan(pg_temp.sp396id(50), true);
SELECT pg_temp.sp396check(pg_temp.sp396count(format('SELECT count(*) FROM public.season_plans WHERE id = %L AND unshared_parts = ''{}'' AND unshared_players = ''{}''',
  pg_temp.sp396id(50))) = 1,
  '2 Share clears what was waiting, though it stamps each player''s objectives');
RESET ROLE;

-- 3. The child reads exactly what was shared, and so does a linked guardian.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(jsonb_array_length(pg_temp.sp396read(20)) = 1
  AND pg_temp.sp396read(20) -> 0 ->> 'squad_player_id' = pg_temp.sp396id(40)::text
  AND pg_temp.sp396read(20) -> 0 ->> 'squad' = 'U16'
  AND pg_temp.sp396read(20) -> 0 ->> 'coach_name' = 'Synthetic Coach One'
  AND pg_temp.sp396read(20) -> 0 ->> 'time_zone' IS NOT NULL
  AND (pg_temp.sp396read(20) -> 0 ->> 'starts_on')::date = pg_temp.sp396today() - 60
  AND (pg_temp.sp396read(20) -> 0 ->> 'ends_on')::date = pg_temp.sp396today() + 200
  AND pg_temp.sp396read(20) -> 0 ->> 'eval_every' = 'month' AND pg_temp.sp396read(20) -> 0 ->> 'eval_day' = '0'
  AND pg_temp.sp396read(20) -> 0 ->> 'last_evaluation_on' IS NULL,
  '3 the child reads their squad, coach, season dates and evaluation rhythm as shared');
SELECT pg_temp.sp396check(pg_temp.sp396read(20) -> 0 ->> 'position' = 'Attacker'
  AND pg_temp.sp396read(20) -> 0 -> 'also_plays' = '["Midfielder"]'::jsonb
  AND pg_temp.sp396read(20) -> 0 -> 'roles' = '["Pressing forward"]'::jsonb,
  '3 the child reads their position, Can also play and role');
SELECT pg_temp.sp396check(pg_temp.sp396titles(pg_temp.sp396read(20) -> 0 -> 'season_objectives') = 'Press high,Stay compact'
  AND pg_temp.sp396read(20) -> 0 -> 'season_objectives' -> 0 ->> 'looks_like' = 'Win it back in five seconds'
  AND (pg_temp.sp396read(20) -> 0 -> 'season_objectives' -> 0 ?& ARRAY['id', 'place', 'title', 'looks_like'])
  AND (SELECT count(*) FROM jsonb_object_keys(pg_temp.sp396read(20) -> 0 -> 'season_objectives' -> 0)) = 4,
  '3 the season objectives are words only: a title and what it looks like');
SELECT pg_temp.sp396check(pg_temp.sp396titles(pg_temp.sp396read(20) -> 0 -> 'objectives') = 'A,B'
  AND pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'A') ->> 'status' = 'open'
  AND pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'A') -> 'current' = 'null'::jsonb
  AND pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'A') -> 'history' = '[]'::jsonb,
  '3 the child reads their objectives, with no evaluation yet');
SELECT pg_temp.sp396check(pg_temp.sp396read(30) = pg_temp.sp396read(20) AND pg_temp.sp396read(30, 20) = pg_temp.sp396read(20),
  '3 a linked guardian reads exactly what the child reads, whether or not they name the child');
SELECT pg_temp.sp396check(jsonb_array_length(pg_temp.sp396read(21)) = 1 AND pg_temp.sp396titles(pg_temp.sp396read(21) -> 0 -> 'objectives') = 'C'
  AND pg_temp.sp396read(21) -> 0 -> 'also_plays' = '[]'::jsonb AND pg_temp.sp396read(21) -> 0 -> 'roles' = '[]'::jsonb
  AND pg_temp.sp396read(31) = pg_temp.sp396read(21),
  '3 each child and guardian read their own row, with no Can also play or role when the coach gave none');
RESET ROLE;

-- 4. Nobody else reads it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(pg_temp.sp396read(31, 20) = '[]'::jsonb AND pg_temp.sp396read(21, 20) = '[]'::jsonb
  AND pg_temp.sp396read(30, 21) = '[]'::jsonb AND pg_temp.sp396read(37) = '[]'::jsonb AND pg_temp.sp396read(37, 20) = '[]'::jsonb,
  '4 another child''s guardian, another child and a guardian of nobody here read nothing, even naming the child');
SELECT pg_temp.sp396check(jsonb_array_length(pg_temp.sp396read(31)) = 1 AND pg_temp.sp396read(31) -> 0 ->> 'squad_player_id' = pg_temp.sp396id(41)::text,
  '4 a guardian with no child named reads only their own child');
SELECT pg_temp.sp396check(pg_temp.sp396read(10, 20) = '[]'::jsonb AND pg_temp.sp396read(10) = '[]'::jsonb
  AND pg_temp.sp396read(11, 20) = '[]'::jsonb AND pg_temp.sp396read(1, 20) = '[]'::jsonb AND pg_temp.sp396read(1) = '[]'::jsonb,
  '4 the coach through this function, another coach and the academy admin read nothing');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.sp396check(pg_temp.sp396refused(format('SELECT * FROM public.season_plan_for_player(%L)', pg_temp.sp396id(20)), '42501')
  AND pg_temp.sp396refused('SELECT public.mark_season_plan_seen()', '42501'),
  '4 anon reads and marks nothing');
RESET ROLE;

-- 5. A player the coach hasn't shared gets no plan, not an empty one: Nia has no objectives, Rae's coach has only a
-- draft, Uma is set up after the first Share.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396actor(10);
SELECT public.save_player_objectives(pg_temp.sp396id(44), '[{"title":"U","source":"own"}]'::jsonb);
SELECT pg_temp.sp396check(pg_temp.sp396read(23) = '[]'::jsonb AND pg_temp.sp396read(33) = '[]'::jsonb,
  '5 a player with no objectives reads nothing, not an empty plan');
SELECT pg_temp.sp396check(pg_temp.sp396read(22) = '[]'::jsonb AND pg_temp.sp396read(32) = '[]'::jsonb,
  '5 a player in a squad whose plan is only a draft reads nothing');
SELECT pg_temp.sp396check(pg_temp.sp396read(25) = '[]'::jsonb AND pg_temp.sp396read(35) = '[]'::jsonb,
  '5 a player set up after the first Share, still waiting to be shared, reads nothing');
RESET ROLE;
SELECT pg_temp.sp396check(pg_temp.sp396count(format('SELECT count(*) FROM public.season_plans WHERE id = %L AND %L = ANY (unshared_players)',
    pg_temp.sp396id(50), pg_temp.sp396id(44))) = 1,
  '5 sanity: the coach''s list does show Uma as waiting');

-- 6. Consent withdrawn hides the plan at once; the academy switch does too.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(jsonb_array_length(pg_temp.sp396read(24)) = 1 AND jsonb_array_length(pg_temp.sp396read(34)) = 1,
  '6 Wes and his guardian read the plan while consent is in place');
SELECT pg_temp.sp396actor(34);
SELECT public.withdraw_parental_consent(pg_temp.sp396id(24));
SELECT pg_temp.sp396check(pg_temp.sp396read(24) = '[]'::jsonb AND pg_temp.sp396read(34) = '[]'::jsonb AND pg_temp.sp396read(34, 24) = '[]'::jsonb,
  '6 once the guardian withdraws consent, the child and the guardian read nothing');
SELECT pg_temp.sp396check(jsonb_array_length(pg_temp.sp396read(20)) = 1, '6 the other children are unaffected');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(pg_temp.sp396read(26) = '[]'::jsonb AND pg_temp.sp396read(36) = '[]'::jsonb,
  '6 an academy with the season_plan switch off reads nothing, though its plan was shared');
RESET ROLE;
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.sp396id(101),'season_plan');
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(jsonb_array_length(pg_temp.sp396read(26)) = 1 AND jsonb_array_length(pg_temp.sp396read(36)) = 1,
  '6 the same plan reads once the switch is on: the switch is what hid it');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.sp396id(101) AND feature = 'season_plan';
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(pg_temp.sp396read(26) = '[]'::jsonb, '6 and switching it off hides it again');
RESET ROLE;

-- 7. "New" is private to each reader and clears when they open it. Nobody else's open counts.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check((pg_temp.sp396read(20) -> 0 ->> 'is_new')::boolean AND (pg_temp.sp396read(30) -> 0 ->> 'is_new')::boolean
  AND (pg_temp.sp396read(21) -> 0 ->> 'is_new')::boolean AND (pg_temp.sp396read(31) -> 0 ->> 'is_new')::boolean,
  '7 a shared plan is New for the child and the guardian until they open it');
SELECT pg_temp.sp396actor(20);
SELECT public.mark_season_plan_seen();
SELECT pg_temp.sp396check(NOT (pg_temp.sp396read(20) -> 0 ->> 'is_new')::boolean AND (pg_temp.sp396read(30) -> 0 ->> 'is_new')::boolean,
  '7 the child opening it clears New for the child only, not for their guardian');
SELECT pg_temp.sp396actor(30);
SELECT public.mark_season_plan_seen(pg_temp.sp396id(20));
SELECT pg_temp.sp396check(NOT (pg_temp.sp396read(30) -> 0 ->> 'is_new')::boolean AND (pg_temp.sp396read(21) -> 0 ->> 'is_new')::boolean
  AND (pg_temp.sp396read(31) -> 0 ->> 'is_new')::boolean,
  '7 the guardian opening it clears it for them; Pia and her guardian are still New');
-- Opening a plan you can't read records nothing.
SELECT pg_temp.sp396actor(31);
SELECT public.mark_season_plan_seen(pg_temp.sp396id(20));
SELECT pg_temp.sp396actor(10);
SELECT public.mark_season_plan_seen(pg_temp.sp396id(20));
SELECT pg_temp.sp396actor(34);
SELECT public.mark_season_plan_seen(pg_temp.sp396id(24));
RESET ROLE;
SELECT pg_temp.sp396check(pg_temp.sp396count(format('SELECT count(*) FROM public.season_plan_seen WHERE viewer_user_id IN (%L, %L, %L)',
    pg_temp.sp396id(31), pg_temp.sp396id(10), pg_temp.sp396id(34))) = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.season_plan_seen') = 2,
  '7 another child''s guardian, the coach and a withdrawn child record nothing: only the two real opens are kept');
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396actor(21);
SELECT public.mark_season_plan_seen();
SELECT pg_temp.sp396actor(31);
SELECT public.mark_season_plan_seen();
RESET ROLE;

-- 8. Edits to one player's objectives wait for Share. The coach removes Ola's B (a plan already shared retires it),
-- adds D, and Uma's U is waiting too. A removal hides at once; an addition does not show.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396actor(10);
SELECT public.save_player_objectives(pg_temp.sp396id(40), '[{"title":"A","source":"own"},{"title":"D","source":"own"}]'::jsonb);
SELECT pg_temp.sp396check(pg_temp.sp396titles(pg_temp.sp396read(20) -> 0 -> 'objectives') = 'A'
  AND pg_temp.sp396titles(pg_temp.sp396read(30) -> 0 -> 'objectives') = 'A',
  '8 a removed objective is not returned, and an added one waits for Share');
SELECT pg_temp.sp396check(NOT (pg_temp.sp396read(20) -> 0 ->> 'is_new')::boolean AND NOT (pg_temp.sp396read(30) -> 0 ->> 'is_new')::boolean,
  '8 an edit nobody has shared makes nothing New');
SELECT pg_temp.sp396check(pg_temp.sp396read(25) = '[]'::jsonb AND pg_temp.sp396read(35) = '[]'::jsonb,
  '8 Uma is still waiting');
SELECT pg_temp.sp396actor(10);
SELECT public.share_season_plan(pg_temp.sp396id(50));
SELECT pg_temp.sp396check(pg_temp.sp396titles(pg_temp.sp396read(20) -> 0 -> 'objectives') = 'A,D'
  AND (pg_temp.sp396read(20) -> 0 ->> 'is_new')::boolean AND (pg_temp.sp396read(30) -> 0 ->> 'is_new')::boolean,
  '8 after Share Ola reads A and D, and it is New again for the child and the guardian');
SELECT pg_temp.sp396check(NOT (pg_temp.sp396read(21) -> 0 ->> 'is_new')::boolean AND NOT (pg_temp.sp396read(31) -> 0 ->> 'is_new')::boolean,
  '8 a Share that changed nothing for Pia leaves her plan opened, not New');
SELECT pg_temp.sp396check(jsonb_array_length(pg_temp.sp396read(25)) = 1 AND (pg_temp.sp396read(25) -> 0 ->> 'is_new')::boolean
  AND jsonb_array_length(pg_temp.sp396read(35)) = 1 AND pg_temp.sp396titles(pg_temp.sp396read(35) -> 0 -> 'objectives') = 'U',
  '8 Uma and her guardian read the plan once it is shared, as New');
RESET ROLE;

-- 9. Edits to the season objectives wait for Share as well. The coach rewords one and adds a third.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396actor(20);
SELECT public.mark_season_plan_seen();
SELECT pg_temp.sp396actor(21);
SELECT public.mark_season_plan_seen();
SELECT pg_temp.sp396actor(10);
UPDATE public.season_objectives SET title = 'Press higher', looks_like = 'Win it back in four seconds'
 WHERE plan_id = pg_temp.sp396id(50) AND place = 1;
INSERT INTO public.season_objectives(plan_id,place,title,looks_like) VALUES(pg_temp.sp396id(50),3,'Third one','Not shared yet');
UPDATE public.season_plans SET starts_on = pg_temp.sp396today() - 61 WHERE id = pg_temp.sp396id(50);
SELECT pg_temp.sp396check(pg_temp.sp396titles(pg_temp.sp396read(20) -> 0 -> 'season_objectives') = 'Press high,Stay compact'
  AND pg_temp.sp396read(20) -> 0 -> 'season_objectives' -> 0 ->> 'looks_like' = 'Win it back in five seconds'
  AND (pg_temp.sp396read(20) -> 0 ->> 'starts_on')::date = pg_temp.sp396today() - 60,
  '9 until Share the reworded and added season objectives and the new start date stay hidden');
SELECT pg_temp.sp396check(NOT (pg_temp.sp396read(21) -> 0 ->> 'is_new')::boolean, '9 and make nothing New');
SELECT pg_temp.sp396actor(10);
SELECT public.share_season_plan(pg_temp.sp396id(50));
SELECT pg_temp.sp396check(pg_temp.sp396titles(pg_temp.sp396read(20) -> 0 -> 'season_objectives') = 'Press higher,Stay compact,Third one'
  AND pg_temp.sp396read(20) -> 0 -> 'season_objectives' -> 0 ->> 'looks_like' = 'Win it back in four seconds'
  AND (pg_temp.sp396read(20) -> 0 ->> 'starts_on')::date = pg_temp.sp396today() - 61,
  '9 after Share they read the new words and dates');
SELECT pg_temp.sp396check((pg_temp.sp396read(20) -> 0 ->> 'is_new')::boolean AND (pg_temp.sp396read(21) -> 0 ->> 'is_new')::boolean
  AND (pg_temp.sp396read(31) -> 0 ->> 'is_new')::boolean,
  '9 a squad-wide change is New for everyone with a plan');
RESET ROLE;

-- 10. A published evaluation is read as published, with no Share. Ola's A: Not yet, then On track. Pia's C: Some
-- progress, then Met (closed). B was removed: its history is not returned either.
INSERT INTO public.season_evaluations(id,plan_id,due_on) VALUES
 (pg_temp.sp396id(70),pg_temp.sp396id(50),pg_temp.sp396today() - 30),(pg_temp.sp396id(71),pg_temp.sp396id(50),pg_temp.sp396today() - 10);
INSERT INTO public.objective_progress(evaluation_id,player_objective_id,status)
 SELECT pg_temp.sp396id(e), o.id, s FROM (VALUES (70,'A','not_yet'),(71,'A','on_track'),(70,'B','not_yet'),(70,'C','some_progress'),(71,'C','met')) v(e,t,s)
 JOIN public.player_objectives o ON o.title = v.t AND o.squad_player_id IN (pg_temp.sp396id(40), pg_temp.sp396id(41));
UPDATE public.player_objectives SET status = 'met', retired_at = now() WHERE title = 'C' AND squad_player_id = pg_temp.sp396id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check(pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'A') ->> 'current' = 'on_track'
  AND pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'A') -> 'history' =
    jsonb_build_array(jsonb_build_object('due_on', pg_temp.sp396today() - 30, 'status', 'not_yet'),
      jsonb_build_object('due_on', pg_temp.sp396today() - 10, 'status', 'on_track'))
  AND (pg_temp.sp396read(20) -> 0 ->> 'last_evaluation_on')::date = pg_temp.sp396today() - 10
  AND pg_temp.sp396read(30) = pg_temp.sp396read(20),
  '10 the status now and at each published evaluation, in order, for the child and the guardian');
SELECT pg_temp.sp396check(pg_temp.sp396obj(pg_temp.sp396read(21) -> 0 -> 'objectives', 'C') ->> 'status' = 'met'
  AND pg_temp.sp396obj(pg_temp.sp396read(21) -> 0 -> 'objectives', 'C') ->> 'current' = 'met'
  AND jsonb_array_length(pg_temp.sp396obj(pg_temp.sp396read(21) -> 0 -> 'objectives', 'C') -> 'history') = 2,
  '10 a Met objective is still returned, with its history');
SELECT pg_temp.sp396check(pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'B') IS NULL
  AND pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'D') ->> 'current' IS NULL,
  '10 the removed objective and its history are not returned; an objective with no evaluation has no word yet');
RESET ROLE;

-- 11. Only the functions read it. The tables behind give players, guardians and coaches nothing, nobody can write what
-- Share stamps, and the coach reads who opened it from nowhere.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396actor(20);
SELECT pg_temp.sp396check(pg_temp.sp396count('SELECT count(*) FROM public.season_plans') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.season_objectives') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.player_objectives') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.season_evaluations') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.objective_progress') = 0,
  '11 a player reads none of the plan''s tables directly');
SELECT pg_temp.sp396actor(30);
SELECT pg_temp.sp396check(pg_temp.sp396count('SELECT count(*) FROM public.season_plans') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.season_objectives') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.player_objectives') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.season_evaluations') = 0
  AND pg_temp.sp396count('SELECT count(*) FROM public.objective_progress') = 0,
  '11 nor does a guardian');
SELECT pg_temp.sp396actor(10);
SELECT pg_temp.sp396check(pg_temp.sp396refused('SELECT count(*) FROM public.season_plan_seen', '42501')
  AND pg_temp.sp396refused('SELECT count(*) FROM public.season_plan_player_shares', '42501')
  AND pg_temp.sp396refused(format('INSERT INTO public.season_plan_seen(viewer_user_id, squad_player_id) VALUES(%L, %L)',
    pg_temp.sp396id(10), pg_temp.sp396id(40)), '42501')
  AND pg_temp.sp396refused('UPDATE public.season_plan_seen SET seen_at = now()', '42501')
  AND pg_temp.sp396refused('DELETE FROM public.season_plan_seen', '42501'),
  '11 the coach cannot read, write or clear who has opened the plan');
SELECT pg_temp.sp396check(pg_temp.sp396refused(format('UPDATE public.season_objectives SET shared_title = ''Sneaked'', shared_looks_like = '''' WHERE plan_id = %L',
    pg_temp.sp396id(50)), '42501')
  AND pg_temp.sp396refused(format('UPDATE public.season_plans SET shared_eval_day = 3 WHERE id = %L', pg_temp.sp396id(50)), '42501')
  AND pg_temp.sp396refused(format('UPDATE public.season_plans SET shared_starts_on = starts_on - 1 WHERE id = %L', pg_temp.sp396id(50)), '42501')
  AND pg_temp.sp396refused(format('UPDATE public.player_objectives SET shared_at = now() WHERE squad_player_id = %L', pg_temp.sp396id(44)), '42501'),
  '11 the coach cannot write what Share stamped, so cannot publish an edit early');
RESET ROLE;
SELECT pg_temp.sp396check(NOT has_table_privilege('anon', 'public.season_plan_seen', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_seen', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_seen', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_seen', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_seen', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.season_plan_player_shares', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_player_shares', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_player_shares', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_player_shares', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.season_plan_player_shares', 'DELETE'),
  '11 the new tables start with no anon or authenticated privilege');
SELECT pg_temp.sp396check(NOT has_function_privilege('anon', 'public.season_plan_for_player(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.season_plan_for_player(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.mark_season_plan_seen(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.mark_season_plan_seen(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.share_season_plan(uuid, boolean)', 'EXECUTE'),
  '11 the read and mark functions are for signed-in users only');

-- 12. The evaluation note is not there. What comes back is the plan's words and nothing else: no note, no private
-- coach text, no match counts, no Good, Watch or At risk.
SET LOCAL ROLE authenticated;
SELECT pg_temp.sp396check((SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(pg_temp.sp396read(20) -> 0) k) = ARRAY[
    'also_plays', 'coach_name', 'ends_on', 'eval_day', 'eval_every', 'is_new', 'last_evaluation_on', 'objectives', 'position',
    'roles', 'season_objectives', 'shared_at', 'squad', 'squad_player_id', 'starts_on', 'time_zone'],
  '12 a row carries only the plan''s words: no note, no coach-only text');
SELECT pg_temp.sp396check((SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(pg_temp.sp396obj(pg_temp.sp396read(20) -> 0 -> 'objectives', 'A')) k)
    = ARRAY['current', 'history', 'id', 'slot', 'status', 'supports', 'title'],
  '12 an objective carries a title, its status and its history, nothing more');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.sp396_results;
 IF total <> 47 THEN RAISE EXCEPTION 'Season plan reads: % checks ran; expected 47', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.sp396_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Season plan reads checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Season plan reads: % of % passed', total, total;
END $$;
ROLLBACK;

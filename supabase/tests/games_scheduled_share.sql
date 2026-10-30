-- @trak-suite mode=--games-scheduled-share in-all=true
-- TRAK-290 (Games 8/8, spec TRAK-282): Share at a time, and the morning-after nudge. No background job. A scheduled
-- plan's copies are written when the coach schedules it and carry the time they go out; nobody reads them before
-- then (or before kick-off, if the match moves earlier). Saving before the time rewrites the waiting copies, so what
-- goes out is the plan as saved (Imad, 29 Oct), and nobody reads "Updated" for a copy nobody has read. An evaluation
-- draft's reminder is the first 09:00 after it was saved, on the academy's clock. Test people are named after
-- footballers. Synthetic fixtures; rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing games-scheduled-share fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.g290id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('92900000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE g290_results(label text, ok boolean);
GRANT SELECT, INSERT ON g290_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.g290actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.g290id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.g290check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.g290_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.g290refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- Schedule match `event` for `at` on the academy's clock ('YYYY-MM-DD HH:MI'), or with no time for the time it has.
CREATE FUNCTION pg_temp.g290schedule(event integer, talked boolean, at text) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.schedule_game_plan(%L,%L,%L)', pg_temp.g290id(event), talked, at)
$$;
-- Copies as fixture numbers, read as whoever is acting.
CREATE FUNCTION pg_temp.g290family() RETURNS integer[] LANGUAGE sql AS $$
 SELECT COALESCE(array_agg(right(squad_player_id::text,3)::integer ORDER BY squad_player_id), '{}') FROM public.game_for_family
$$;
CREATE FUNCTION pg_temp.g290player() RETURNS integer[] LANGUAGE sql AS $$
 SELECT COALESCE(array_agg(right(squad_player_id::text,3)::integer ORDER BY squad_player_id), '{}') FROM public.game_for_player
$$;
-- Every copy of match `event` goes out at `at`, read by the operator.
CREATE FUNCTION pg_temp.g290copiesat(event integer, at timestamptz) RETURNS boolean LANGUAGE sql AS $$
 SELECT (SELECT bool_and(shared_at = at) AND count(*) > 0 FROM public.game_for_family WHERE event_id = pg_temp.g290id(event))
   AND (SELECT bool_and(shared_at = at) AND count(*) > 0 FROM public.game_for_player WHERE event_id = pg_temp.g290id(event))
   AND (SELECT count(*) = 1 AND min(shared_at) = at FROM public.game_shares WHERE event_id = pg_temp.g290id(event))
$$;
-- The clock reaching match `event`'s share time: its copies and its share went out a minute ago.
CREATE FUNCTION pg_temp.g290timepasses(event integer) RETURNS void LANGUAGE sql AS $$
 UPDATE public.game_for_family SET shared_at = now() - interval '1 minute' WHERE event_id = pg_temp.g290id(event);
 UPDATE public.game_for_player SET shared_at = now() - interval '1 minute' WHERE event_id = pg_temp.g290id(event);
 UPDATE public.game_shares SET shared_at = now() - interval '1 minute' WHERE event_id = pg_temp.g290id(event);
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy Dubai (100) and Academy Athens (102) have Games. Didier Deschamps (10) and Laurent Blanc (11) coach at
-- Dubai, Raymond Domenech (12) at Athens. Didier's U16 roster: Zinedine Zidane (40, player A), Thierry Henry (41,
-- player B), Fabien Barthez (45, keeper), all consented, and David Trezeguet (42), consent pending. Lilian Thuram (30)
-- is player A's guardian, Marcel Desailly (31) player B's, Bixente Lizarazu (35) the keeper's. Raymond's U16 roster:
-- Robert Pires (47).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.g290id(n),'synthetic-'||n||'@games290.invalid',now()
 FROM unnest(ARRAY[1,2,10,11,12,20,21,22,25,30,31,35]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.g290id(1),'club','Aime Jacquet'),(pg_temp.g290id(2),'club','Roger Lemerre'),
 (pg_temp.g290id(10),'coach','Didier Deschamps'),(pg_temp.g290id(11),'coach','Laurent Blanc'),(pg_temp.g290id(12),'coach','Raymond Domenech'),
 (pg_temp.g290id(20),'player','Zinedine Zidane'),(pg_temp.g290id(21),'player','Thierry Henry'),
 (pg_temp.g290id(22),'player','David Trezeguet'),(pg_temp.g290id(25),'player','Fabien Barthez'),
 (pg_temp.g290id(30),'parent','Lilian Thuram'),(pg_temp.g290id(31),'parent','Marcel Desailly'),(pg_temp.g290id(35),'parent','Bixente Lizarazu');
INSERT INTO public.organizations(id,admin_user_id,name,join_code,time_zone) VALUES
 (pg_temp.g290id(100),pg_temp.g290id(1),'Scheduled Dubai Academy','G290D1','Asia/Dubai'),
 (pg_temp.g290id(102),pg_temp.g290id(2),'Scheduled Athens Academy','G290A1','Europe/Athens');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.g290id(10),pg_temp.g290id(100)),(pg_temp.g290id(11),pg_temp.g290id(100)),(pg_temp.g290id(12),pg_temp.g290id(102));
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.g290id(n), current_date - interval '14 years' FROM unnest(ARRAY[20,21,22,25]) n;
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.g290id(20),pg_temp.g290id(30)),(pg_temp.g290id(21),pg_temp.g290id(31)),(pg_temp.g290id(25),pg_temp.g290id(35));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id,age_group) VALUES
 (pg_temp.g290id(40),pg_temp.g290id(10),'Zinedine Zidane',pg_temp.g290id(20),'U16'),
 (pg_temp.g290id(41),pg_temp.g290id(10),'Thierry Henry',pg_temp.g290id(21),'U16'),
 (pg_temp.g290id(42),pg_temp.g290id(10),'David Trezeguet',pg_temp.g290id(22),'U16'),
 (pg_temp.g290id(45),pg_temp.g290id(10),'Fabien Barthez',pg_temp.g290id(25),'U16'),
 (pg_temp.g290id(47),pg_temp.g290id(12),'Robert Pires',NULL,'U16');
-- Didier's U16 matches at 19:00 Dubai (15:00 UTC): 500 is scheduled, 506 is scheduled then shared now, 507 is
-- scheduled then moved, 505 has no plan. 508 is Raymond's, in Athens, for the nudge.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,opponent,starts_at,start_time,published,squad) VALUES
 (pg_temp.g290id(500),pg_temp.g290id(10),'vs Brazil','match','Brazil','2054-11-07 15:00+00','19:00',true,'U16'),
 (pg_temp.g290id(505),pg_temp.g290id(10),'vs Italy','match','Italy','2054-11-21 15:00+00','19:00',true,'U16'),
 (pg_temp.g290id(506),pg_temp.g290id(10),'vs Croatia','match','Croatia','2054-11-28 15:00+00','19:00',true,'U16'),
 (pg_temp.g290id(507),pg_temp.g290id(10),'vs Paraguay','match','Paraguay','2054-12-05 15:00+00','19:00',true,'U16'),
 (pg_temp.g290id(508),pg_temp.g290id(12),'vs Greece','match','Greece','2026-10-24 13:00+00','16:00',true,'U16');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g290id(100),'games'),(pg_temp.g290id(102),'games');

SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(g), public.record_parental_consent(pg_temp.g290id(c),'parent','{"coaching_records":true}'::jsonb,
  'synthetic-v1','Synthetic disposable consent.')
 FROM (VALUES (30,20),(31,21),(35,25)) AS consent(g,c);
-- Didier's plans: for 500 the keeper and player A start with jobs, player A with a note; player B isn't placed, so
-- he's on the bench. 506 and 507 have a plan with nobody placed.
SELECT pg_temp.g290actor(10);
INSERT INTO public.game_plans(event_id,goals,formation) VALUES
 (pg_temp.g290id(500),'[{"title":"Keep the ball","looks_like":"Ten passes before we go forward."}]','4-4-2'),
 (pg_temp.g290id(506),'[]','4-4-2'),(pg_temp.g290id(507),'[]','4-4-2');
INSERT INTO public.game_plan_players(event_id,squad_player_id,role,slot,job,note,context,expectation) VALUES
 (pg_temp.g290id(500),pg_temp.g290id(45),'starter',1,'Command the box.','','{}','usual'),
 (pg_temp.g290id(500),pg_temp.g290id(40),'starter',7,'Find the pass between the lines.','Your game today.','{}','usual');
RESET ROLE;

-- ── 1. Scheduling has conditions ───────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(11);
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,true,'2054-11-06 19:30'),'42501'),'1 another coach can''t schedule Didier''s plan');
SELECT pg_temp.g290actor(20);
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,true,'2054-11-06 19:30'),'42501'),'1 a player can''t schedule');
SELECT pg_temp.g290actor(10);
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,false,'2054-11-06 19:30'),'P0001'),'1 not before the coach has talked selection through');
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,true,'2020-11-06 19:30'),'P0001'),'1 not at a time that has passed');
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,true,'2054-11-07 19:00'),'P0001'),'1 not at kick-off');
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,true,'2054-11-07 21:00'),'P0001'),'1 not after kick-off');
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,true,NULL),'P0001'),'1 no time and nothing waiting: refused');

-- ── 2. Scheduled for later: nobody reads it yet ────────────────────────────
SELECT pg_temp.g290check((SELECT public.schedule_game_plan(pg_temp.g290id(500),true,'2054-11-06 19:30'))=3,
  '2 the coach schedules it for 3 children');
SELECT pg_temp.g290check((SELECT count(*)=0 FROM public.game_plan_changes(ARRAY[pg_temp.g290id(500)])),
  '2 a waiting plan has no "Changes not shared"');
RESET ROLE;
SELECT pg_temp.g290check(pg_temp.g290copiesat(500,'2054-11-06 15:30+00'),
  '2 every copy and the share go out at 19:30 on the academy''s clock (15:30 UTC)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(20);
SELECT pg_temp.g290check(pg_temp.g290family()='{}' AND pg_temp.g290player()='{}','2 player A reads nothing before 19:30');
SELECT pg_temp.g290actor(21);
SELECT pg_temp.g290check(pg_temp.g290family()='{}' AND pg_temp.g290player()='{}','2 player B reads nothing before 19:30');
SELECT pg_temp.g290actor(30);
SELECT pg_temp.g290check(pg_temp.g290family()='{}' AND pg_temp.g290player()='{}','2 nor does player A''s guardian');
SELECT pg_temp.g290actor(11);
SELECT pg_temp.g290check(pg_temp.g290family()='{}' AND pg_temp.g290player()='{}','2 nor another coach');
SELECT pg_temp.g290actor(22);
SELECT pg_temp.g290check(pg_temp.g290family()='{}' AND pg_temp.g290player()='{}','2 nor a child waiting for consent');

-- ── 3. Saved before the time: it goes out as saved ─────────────────────────
SELECT pg_temp.g290actor(10);
UPDATE public.game_plan_players SET job='Find the pass, then run.' WHERE event_id=pg_temp.g290id(500) AND squad_player_id=pg_temp.g290id(40);
SELECT pg_temp.g290check((SELECT count(*)=0 FROM public.game_plan_changes(ARRAY[pg_temp.g290id(500)])),
  '3 an edit to a waiting plan is never "Changes not shared"');
SELECT pg_temp.g290check((SELECT public.schedule_game_plan(pg_temp.g290id(500),false,NULL))=1,
  '3 saving rewrites the waiting copy whose words changed');
RESET ROLE;
SELECT pg_temp.g290check((SELECT job='Find the pass, then run.' AND changed_at IS NULL FROM public.game_for_family
  WHERE squad_player_id=pg_temp.g290id(40)), '3 the waiting copy has the new job and reads as new, not Updated');
SELECT pg_temp.g290check(pg_temp.g290copiesat(500,'2054-11-06 15:30+00'),'3 it still goes out at 19:30, logged once');

-- ── 4. Change the time ─────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(10);
SELECT pg_temp.g290check((SELECT public.schedule_game_plan(pg_temp.g290id(500),false,'2054-11-06 20:00'))=0,
  '4 the coach moves it to 20:00; no words changed');
RESET ROLE;
SELECT pg_temp.g290check(pg_temp.g290copiesat(500,'2054-11-06 16:00+00'),'4 every copy and the share move to 20:00');

-- ── 5. The time comes ──────────────────────────────────────────────────────
SELECT pg_temp.g290timepasses(500);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(20);
SELECT pg_temp.g290check(pg_temp.g290family()=ARRAY[40] AND pg_temp.g290player()=ARRAY[40],'5 then player A reads their plan and note');
SELECT pg_temp.g290actor(21);
SELECT pg_temp.g290check(pg_temp.g290family()=ARRAY[41] AND pg_temp.g290player()=ARRAY[41],'5 player B reads theirs');
SELECT pg_temp.g290actor(30);
SELECT pg_temp.g290check(pg_temp.g290family()=ARRAY[40] AND pg_temp.g290player()='{}','5 player A''s guardian reads the job, not the note');
SELECT pg_temp.g290actor(11);
SELECT pg_temp.g290check(pg_temp.g290family()='{}' AND pg_temp.g290player()='{}','5 another coach still reads nothing');
SELECT pg_temp.g290actor(22);
SELECT pg_temp.g290check(pg_temp.g290family()='{}' AND pg_temp.g290player()='{}','5 a child waiting for consent still reads nothing');
SELECT pg_temp.g290actor(10);
SELECT pg_temp.g290check(pg_temp.g290refused(pg_temp.g290schedule(500,false,'2054-11-06 21:00'),'P0001')
  AND pg_temp.g290refused(pg_temp.g290schedule(500,false,NULL),'P0001'),'5 once it''s out it can''t be scheduled again');
UPDATE public.game_plan_players SET job='Find the pass early.' WHERE event_id=pg_temp.g290id(500) AND squad_player_id=pg_temp.g290id(40);
SELECT pg_temp.g290check((SELECT count(*)=1 FROM public.game_plan_changes(ARRAY[pg_temp.g290id(500)])),
  '5 an edit after it''s out waits for "Share the changes"');
SELECT pg_temp.g290check((SELECT public.share_game_plan(pg_temp.g290id(500),false))=1,'5 sharing the changes now reaches 1 child');
RESET ROLE;
SELECT pg_temp.g290check((SELECT changed_at IS NOT NULL FROM public.game_for_family WHERE squad_player_id=pg_temp.g290id(40) AND event_id=pg_temp.g290id(500)),
  '5 a copy someone could read reads Updated');

-- ── 6. Share now while it waits ────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(10);
SELECT public.schedule_game_plan(pg_temp.g290id(506),true,'2054-11-27 19:30');
SELECT pg_temp.g290actor(20);
SELECT pg_temp.g290check(NOT (pg_temp.g290id(506)=ANY(SELECT event_id FROM public.game_for_family)),'6 a second plan waits for Thursday');
SELECT pg_temp.g290actor(10);
SELECT public.share_game_plan(pg_temp.g290id(506),false);
SELECT pg_temp.g290actor(20);
SELECT pg_temp.g290check(pg_temp.g290id(506)=ANY(SELECT event_id FROM public.game_for_family)
  AND pg_temp.g290id(506)=ANY(SELECT event_id FROM public.game_for_player),'6 Share now sends it at once');
RESET ROLE;
SELECT pg_temp.g290check((SELECT count(*)=1 AND max(shared_at)<=now() FROM public.game_shares WHERE event_id=pg_temp.g290id(506))
  AND (SELECT bool_and(changed_at IS NULL) FROM public.game_for_family WHERE event_id=pg_temp.g290id(506)),
  '6 one share in the log, now, and nothing reads Updated');

-- ── 7. A match moved before the share time shows the plan at kick-off ──────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(10);
SELECT public.schedule_game_plan(pg_temp.g290id(507),true,'2054-12-04 19:30');
RESET ROLE;
UPDATE public.coach_calendar_events SET starts_at=now() - interval '1 minute' WHERE id=pg_temp.g290id(507);
SET LOCAL ROLE authenticated;
SELECT pg_temp.g290actor(20);
SELECT pg_temp.g290check(pg_temp.g290id(507)=ANY(SELECT event_id FROM public.game_for_family),'7 kicked off before the share time: player A reads it');
RESET ROLE;

-- ── 8. The morning-after nudge: the first 09:00 after the save, on the academy's clock ──
INSERT INTO public.game_evaluations(event_id) VALUES(pg_temp.g290id(500)),(pg_temp.g290id(508));
SELECT pg_temp.g290check((SELECT remind_at IS NOT NULL FROM public.game_evaluations WHERE event_id=pg_temp.g290id(500)),
  '8 a new draft gets its reminder');
UPDATE public.game_evaluations SET saved_at='2054-11-07 22:40+04' WHERE event_id=pg_temp.g290id(500);
SELECT pg_temp.g290check((SELECT remind_at='2054-11-08 09:00+04' FROM public.game_evaluations WHERE event_id=pg_temp.g290id(500)),
  '8 saved 22:40 in Dubai: 09:00 the next morning');
UPDATE public.game_evaluations SET saved_at='2054-11-08 00:30+04' WHERE event_id=pg_temp.g290id(500);
SELECT pg_temp.g290check((SELECT remind_at='2054-11-08 09:00+04' FROM public.game_evaluations WHERE event_id=pg_temp.g290id(500)),
  '8 saved 00:30: 09:00 that morning');
UPDATE public.game_evaluations SET saved_at='2054-11-08 09:00+04' WHERE event_id=pg_temp.g290id(500);
SELECT pg_temp.g290check((SELECT remind_at='2054-11-09 09:00+04' FROM public.game_evaluations WHERE event_id=pg_temp.g290id(500)),
  '8 saved at 09:00: 09:00 the next day');
UPDATE public.game_evaluations SET saved_at='2026-10-24 22:00+03' WHERE event_id=pg_temp.g290id(508);
SELECT pg_temp.g290check((SELECT remind_at='2026-10-25 09:00+02' FROM public.game_evaluations WHERE event_id=pg_temp.g290id(508)),
  '8 Athens across its clock change: 09:00 Athens time, not 09:00 Dubai or UTC');
UPDATE public.game_evaluations SET published_at=now() WHERE event_id=pg_temp.g290id(508);
SELECT pg_temp.g290check((SELECT remind_at='2026-10-25 09:00+02' FROM public.game_evaluations WHERE event_id=pg_temp.g290id(508)),
  '8 publishing doesn''t move it');

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.g290_results;
 IF total <> 40 THEN RAISE EXCEPTION 'Game scheduled share: % checks ran; expected 40', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.g290_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Game scheduled share checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Game scheduled share: % of % passed', total, total;
END $$;
ROLLBACK;

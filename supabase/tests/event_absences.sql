-- @trak-suite mode=--event-absences-review in-all=true
-- TRAK-137 (J8.14): "Can't make it". A linked guardian reports that their
-- child won't attend a published, scheduled event of the child's current squad,
-- with an optional short reason, and can undo it until kickoff (an event with
-- no time yet: until the end of its day in Dubai). It is a write about a
-- child, so it needs that child's active consent (G1), and the academy's
-- events switch on. The event's coach sees their event's absences; a guardian
-- sees only their own child's. Nobody writes the table directly. Synthetic
-- fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing event-absence fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.eaid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('98400000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE ea_results(label text, ok boolean, detail text);
GRANT INSERT ON ea_results TO authenticated, anon;
CREATE FUNCTION pg_temp.eaactor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.eaid(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.eacheck(ok boolean,label text,detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.ea_results VALUES(label,ok IS TRUE,detail)
$$;
-- The statement must succeed.
CREATE FUNCTION pg_temp.eaok(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN msg := SQLSTATE||': '||SQLERRM; END;
 INSERT INTO pg_temp.ea_results VALUES(label, msg IS NULL, msg);
END $$;
-- The statement must be refused with 42501 (or 23514 for a bad value) and the
-- given words in the message.
CREATE FUNCTION pg_temp.earefused(statement text, label text, state text, words text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text; msg text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM; END;
 INSERT INTO pg_temp.ea_results VALUES(label, st = state AND msg ILIKE '%'||words||'%', coalesce(st||': '||msg,'unexpectedly succeeded'));
END $$;
CREATE FUNCTION pg_temp.eareport(event integer, child integer, reason text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.report_cant_make_it(%L, %L, %L)', pg_temp.eaid(event), pg_temp.eaid(child), reason)
$$;
CREATE FUNCTION pg_temp.eaundo(event integer, child integer) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.undo_cant_make_it(%L, %L)', pg_temp.eaid(event), pg_temp.eaid(child))
$$;
-- Absences the caller can read, as event-suffix:child-suffix pairs.
SET LOCAL check_function_bodies = off;
CREATE FUNCTION pg_temp.easeen() RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(right(a.event_id::text,3)||':'||right(sp.linked_player_id::text,2), ',' ORDER BY a.event_id, sp.linked_player_id),'none')
 FROM public.event_absences a JOIN public.squad_players sp ON sp.id = a.squad_player_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.easeen() TO authenticated;

-- Academy X (100, events on): coach A (10), coach B (11). Academy Y (101,
-- events OFF): coach Y (12). Parent P (30): child S1 (20, A's squad,
-- consented) and S2 (21, A's squad, NOT consented). Parent Q (31): child C
-- (22, B's squad, consented). Child Y1 (23, Y's squad, consented by parent R 32).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.eaid(n),'synthetic-'||n||'@absences.invalid',now()
 FROM unnest(ARRAY[1,2,10,11,12,20,21,22,23,24,30,31,32]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.eaid(1),'club','Admin X'),(pg_temp.eaid(2),'club','Admin Y'),
 (pg_temp.eaid(10),'coach','Coach A'),(pg_temp.eaid(11),'coach','Coach B'),(pg_temp.eaid(12),'coach','Coach Y'),
 (pg_temp.eaid(20),'player','Sibling One'),(pg_temp.eaid(21),'player','Sibling Two'),
 (pg_temp.eaid(22),'player','Child C'),(pg_temp.eaid(23),'player','Child Y'),(pg_temp.eaid(24),'player','Child D'),
 (pg_temp.eaid(30),'parent','Parent P'),(pg_temp.eaid(31),'parent','Parent Q'),(pg_temp.eaid(32),'parent','Parent R');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.eaid(100),pg_temp.eaid(1),'Absences X','EA14X1'),(pg_temp.eaid(101),pg_temp.eaid(2),'Absences Y','EA14Y1');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.eaid(100),'events');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.eaid(10),pg_temp.eaid(100)),(pg_temp.eaid(11),pg_temp.eaid(100)),(pg_temp.eaid(12),pg_temp.eaid(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.eaid(20),current_date - interval '10 years'),(pg_temp.eaid(21),current_date - interval '12 years'),
 (pg_temp.eaid(22),current_date - interval '10 years'),(pg_temp.eaid(23),current_date - interval '10 years'),
 (pg_temp.eaid(24),current_date - interval '10 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.eaid(20),pg_temp.eaid(30)),(pg_temp.eaid(21),pg_temp.eaid(30)),
 (pg_temp.eaid(22),pg_temp.eaid(31)),(pg_temp.eaid(23),pg_temp.eaid(32)),(pg_temp.eaid(24),pg_temp.eaid(31));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id) VALUES
 (pg_temp.eaid(40),pg_temp.eaid(10),'Sibling One',pg_temp.eaid(20)),
 (pg_temp.eaid(41),pg_temp.eaid(10),'Sibling Two',pg_temp.eaid(21)),
 (pg_temp.eaid(42),pg_temp.eaid(11),'Child C',pg_temp.eaid(22)),
 (pg_temp.eaid(43),pg_temp.eaid(12),'Child Y',pg_temp.eaid(23)),
 (pg_temp.eaid(44),pg_temp.eaid(10),'Child D',pg_temp.eaid(24));
-- Child D (24, parent Q) sits on A's squad in a row the coach has left.
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.eaid(44);
-- 700 A future timed; 701 A future draft; 702 A cancelled; 703 A started an
-- hour ago; 704 A untimed today; 705 B future; 706 Y future (academy off).
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at,event_date,start_time,published) VALUES
 (pg_temp.eaid(700),pg_temp.eaid(10),'A training',now() + interval '2 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '2 days')::date,(now() AT TIME ZONE 'Asia/Dubai')::time,true),
 (pg_temp.eaid(701),pg_temp.eaid(10),'A draft',now() + interval '2 days',NULL,NULL,false),
 (pg_temp.eaid(702),pg_temp.eaid(10),'A cancelled',now() + interval '3 days',NULL,NULL,true),
 (pg_temp.eaid(703),pg_temp.eaid(10),'A started',now() - interval '1 hour',(now() AT TIME ZONE 'Asia/Dubai' - interval '1 hour')::date,(now() AT TIME ZONE 'Asia/Dubai' - interval '1 hour')::time,true),
 (pg_temp.eaid(704),pg_temp.eaid(10),'A untimed today',date_trunc('day', now()),(now() AT TIME ZONE 'Asia/Dubai')::date,NULL,true),
 (pg_temp.eaid(705),pg_temp.eaid(11),'B training',now() + interval '2 days',NULL,NULL,true),
 (pg_temp.eaid(706),pg_temp.eaid(12),'Y training',now() + interval '2 days',NULL,NULL,true);
UPDATE public.coach_calendar_events SET status='cancelled' WHERE id=pg_temp.eaid(702);

SET LOCAL ROLE authenticated;
SELECT pg_temp.eaactor(30);
SELECT public.record_parental_consent(pg_temp.eaid(20),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.eaactor(31);
SELECT public.record_parental_consent(pg_temp.eaid(22),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT public.record_parental_consent(pg_temp.eaid(24),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.eaactor(32);
SELECT public.record_parental_consent(pg_temp.eaid(23),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');

-- ── 1. The guardian reports, changes the reason, and undoes ────────────────
SELECT pg_temp.eaactor(30);
SELECT pg_temp.eaok(pg_temp.eareport(700,20,'Dentist'),'1 a guardian reports their child can''t make a published training');
SELECT pg_temp.eaok(pg_temp.eareport(700,20,'School trip'),'1 reporting again just updates the reason');
SELECT pg_temp.eaok(pg_temp.eareport(704,20),'1 an untimed event today can still be reported (until the end of its day)');
SELECT pg_temp.eacheck(pg_temp.easeen()='700:20,704:20','1 the guardian reads their own child''s absences',pg_temp.easeen());
SELECT pg_temp.eaok(pg_temp.eaundo(704,20),'1 the guardian undoes one');
SELECT pg_temp.eacheck(pg_temp.easeen()='700:20','1 the undone absence is gone',pg_temp.easeen());

-- ── 2. Refused, with a reason a screen can show ────────────────────────────
SELECT pg_temp.earefused(pg_temp.eareport(700,21),'2 a child without consent cannot be reported (G1)','42501','consent');
SELECT pg_temp.earefused(pg_temp.eareport(705,22),'2 a guardian cannot report another family''s child','42501','guardian');
SELECT pg_temp.earefused(pg_temp.eareport(705,20),'2 an event of another squad is refused','42501','not available');
SELECT pg_temp.earefused(pg_temp.eareport(701,20),'2 a draft is refused','42501','not available');
SELECT pg_temp.earefused(pg_temp.eareport(702,20),'2 a cancelled event is refused','42501','cancelled');
SELECT pg_temp.earefused(pg_temp.eareport(703,20),'2 an event that has started is refused','42501','started');
SELECT pg_temp.earefused(pg_temp.eaundo(703,20),'2 an undo after kickoff is refused','42501','started');
SELECT pg_temp.earefused(pg_temp.eareport(700,20,repeat('x',141)),'2 a reason over 140 characters is refused','23514','');
SELECT pg_temp.eaactor(32);
SELECT pg_temp.earefused(pg_temp.eareport(706,23),'2 an academy with events switched off is refused','42501','switched off');
SELECT pg_temp.eaactor(20);
SELECT pg_temp.earefused(pg_temp.eareport(700,20),'2 the child cannot report themselves (players don''t answer in v1)','42501','guardian');
SELECT pg_temp.earefused(format('INSERT INTO public.event_absences(event_id,squad_player_id,reported_by) VALUES(%L,%L,%L)',
  pg_temp.eaid(705),pg_temp.eaid(42),pg_temp.eaid(20)),'2 nobody writes the table directly','42501','');

-- ── 3. Who reads ───────────────────────────────────────────────────────────
SELECT pg_temp.eaactor(31);
SELECT pg_temp.earefused(pg_temp.eareport(700,24),'2 a squad row the coach has left can''t be reported through','42501','not available');
SELECT pg_temp.eaok(pg_temp.eareport(705,22,'Away'),'3 parent Q reports their own child');
SELECT pg_temp.eacheck(pg_temp.easeen()='705:22','3 parent Q sees only their own child''s absence',pg_temp.easeen());
SELECT pg_temp.eaactor(10);
SELECT pg_temp.eacheck(pg_temp.easeen()='700:20','3 coach A sees their own event''s absence, not coach B''s',pg_temp.easeen());
SELECT pg_temp.eaactor(11);
SELECT pg_temp.eacheck(pg_temp.easeen()='705:22','3 coach B sees only their own',pg_temp.easeen());
SELECT pg_temp.eaactor(20);
SELECT pg_temp.eacheck(pg_temp.easeen()='none','3 a child reads no absences (players don''t answer in v1)',pg_temp.easeen());

-- ── 4. Withdrawal: no more reports, and the guardian's view hides ─────────
SELECT pg_temp.eaactor(30);
SELECT pg_temp.eacheck(public.withdraw_parental_consent(pg_temp.eaid(20)) >= 1,'4 parent P withdraws for sibling one');
SELECT pg_temp.eacheck(pg_temp.easeen()='none','4 after withdrawal the guardian reads none of that child''s absences',pg_temp.easeen());
SELECT pg_temp.earefused(pg_temp.eaundo(700,20),'4 after withdrawal an undo is refused too','42501','consent');
SELECT pg_temp.eaactor(10);
SELECT pg_temp.eacheck(pg_temp.easeen()='700:20','4 the coach still sees the absence reported before withdrawal',pg_temp.easeen());
RESET ROLE;
SELECT pg_temp.eacheck((SELECT reason='School trip' AND reported_by=pg_temp.eaid(30) FROM public.event_absences
  WHERE event_id=pg_temp.eaid(700) AND squad_player_id=pg_temp.eaid(40)),'4 readback: one row, the latest reason, the reporting guardian');
SELECT pg_temp.eacheck(NOT has_function_privilege('anon','public.report_cant_make_it(uuid,uuid,text)','EXECUTE')
  AND NOT has_table_privilege('authenticated','public.event_absences','INSERT'),'4 no anonymous calls and no direct inserts');

DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.ea_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.ea_results;
 IF n <> 29 THEN RAISE EXCEPTION 'Event absences: % checks ran; expected exactly 29', n; END IF;
 IF failures IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE='Event absences failed',DETAIL=failures; END IF;
 RAISE NOTICE 'Event absences: % checks passed',n;
END $$;
ROLLBACK;

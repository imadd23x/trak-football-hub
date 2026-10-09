-- @trak-suite mode=--child-events-review in-all=true
-- TRAK-131 (J8.8): child_events(p_child) is one child's published events, for
-- that child or a linked guardian, under THAT child's consent. RLS alone
-- answers "can this parent read the event" across all their children, so a
-- withdrawn child in the same squad as a consented sibling would still show the
-- squad's events. The function also never returns the coach's notes (bands-only
-- for parents). Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing child-events fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.ceid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('98300000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE ce_results(label text, ok boolean, detail text);
GRANT INSERT ON ce_results TO authenticated, anon;
CREATE FUNCTION pg_temp.ceactor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ceid(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.cecheck(ok boolean,label text,detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.ce_results VALUES(label,ok IS TRUE,detail)
$$;
-- The child's events the caller gets, by the last three digits of the id.
SET LOCAL check_function_bodies = off;
CREATE FUNCTION pg_temp.ceseen(child integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
 SELECT coalesce(string_agg(right(id::text,3), ',' ORDER BY id),'none') INTO r
 FROM public.child_events(pg_temp.ceid(child));
 RETURN r;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ceseen(integer) TO authenticated;

-- Academy X (100): coach A (10), coach B (11). Academy Y (101): coach Y (12).
-- Parent P (30): child S1 (20, A's squad, consented), child S2 (21, A's squad,
-- NOT consented), child C (22, B's squad, consented). Parent Q (31): no link.
-- Adult D (23, A's squad, row coach_departed).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.ceid(n),'synthetic-'||n||'@childevents.invalid',now()
 FROM unnest(ARRAY[1,2,10,11,12,20,21,22,23,30,31]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.ceid(1),'club','Admin X'),(pg_temp.ceid(2),'club','Admin Y'),
 (pg_temp.ceid(10),'coach','Coach A'),(pg_temp.ceid(11),'coach','Coach B'),(pg_temp.ceid(12),'coach','Coach Y'),
 (pg_temp.ceid(20),'player','Sibling One'),(pg_temp.ceid(21),'player','Sibling Two'),
 (pg_temp.ceid(22),'player','Child C'),(pg_temp.ceid(23),'player','Adult D'),
 (pg_temp.ceid(30),'parent','Parent P'),(pg_temp.ceid(31),'parent','Parent Q');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.ceid(100),pg_temp.ceid(1),'Child Events X','CE8X01'),(pg_temp.ceid(101),pg_temp.ceid(2),'Child Events Y','CE8Y01');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.ceid(10),pg_temp.ceid(100)),(pg_temp.ceid(11),pg_temp.ceid(100)),(pg_temp.ceid(12),pg_temp.ceid(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.ceid(20),current_date - interval '10 years'),(pg_temp.ceid(21),current_date - interval '12 years'),
 (pg_temp.ceid(22),current_date - interval '10 years'),(pg_temp.ceid(23),current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.ceid(20),pg_temp.ceid(30)),(pg_temp.ceid(21),pg_temp.ceid(30)),(pg_temp.ceid(22),pg_temp.ceid(30));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id) VALUES
 (pg_temp.ceid(40),pg_temp.ceid(10),'Sibling One',pg_temp.ceid(20)),
 (pg_temp.ceid(41),pg_temp.ceid(10),'Sibling Two',pg_temp.ceid(21)),
 (pg_temp.ceid(42),pg_temp.ceid(11),'Child C',pg_temp.ceid(22)),
 (pg_temp.ceid(43),pg_temp.ceid(10),'Adult D',pg_temp.ceid(23));
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.ceid(43);
-- 600 A published, 601 A draft, 602 B published, 603 Y published.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at,published,notes) VALUES
 (pg_temp.ceid(600),pg_temp.ceid(10),'A training','2026-11-02 16:00+00',true,'SECRET coach note'),
 (pg_temp.ceid(601),pg_temp.ceid(10),'A draft','2026-11-03 16:00+00',false,NULL),
 (pg_temp.ceid(602),pg_temp.ceid(11),'B training','2026-11-02 16:00+00',true,NULL),
 (pg_temp.ceid(603),pg_temp.ceid(12),'Y training','2026-11-02 16:00+00',true,NULL);

SET LOCAL ROLE authenticated;
SELECT pg_temp.ceactor(30);
SELECT public.record_parental_consent(pg_temp.ceid(20),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT public.record_parental_consent(pg_temp.ceid(22),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');

-- ── 1. A parent sees each child's events, under that child's consent ──────
SELECT pg_temp.cecheck(pg_temp.ceseen(20)='600','1 the parent sees the consented child''s published squad event, not the draft',pg_temp.ceseen(20));
SELECT pg_temp.cecheck(pg_temp.ceseen(21)='none','1 the parent sees nothing for the unconsented sibling in the same squad',pg_temp.ceseen(21));
SELECT pg_temp.cecheck(pg_temp.ceseen(22)='602','1 the parent sees the third child''s own squad only',pg_temp.ceseen(22));
-- ── 2. The child, and nobody else ──────────────────────────────────────────
SELECT pg_temp.ceactor(20);
SELECT pg_temp.cecheck(pg_temp.ceseen(20)='600','2 the child sees their own events',pg_temp.ceseen(20));
SELECT pg_temp.cecheck(pg_temp.ceseen(22)='none','2 a child cannot read another child''s events',pg_temp.ceseen(22));
SELECT pg_temp.ceactor(31);
SELECT pg_temp.cecheck(pg_temp.ceseen(20)='none','2 a parent with no link reads nothing',pg_temp.ceseen(20));
SELECT pg_temp.ceactor(10);
SELECT pg_temp.cecheck(pg_temp.ceseen(20)='none','2 the coach is not family here (they read their own events directly)',pg_temp.ceseen(20));
SELECT pg_temp.ceactor(23);
SELECT pg_temp.cecheck(pg_temp.ceseen(23)='none','2 a squad row the coach has left shows nothing',pg_temp.ceseen(23));
-- Coach B moves to academy Y; child C's squad row stays in X, so an event B
-- makes in Y is not read through it.
RESET ROLE;
UPDATE public.coach_details SET organization_id=pg_temp.ceid(101) WHERE user_id=pg_temp.ceid(11);
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at,published)
 VALUES(pg_temp.ceid(604),pg_temp.ceid(11),'B training in Y','2026-11-09 16:00+00',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ceactor(30);
SELECT pg_temp.cecheck(pg_temp.ceseen(22)='602','2 a coach''s event in another academy is not read through the old squad row',pg_temp.ceseen(22));
-- ── 3. Withdrawal hides on the next call; the coach's notes never leave ────
SELECT pg_temp.ceactor(30);
SELECT pg_temp.cecheck(public.withdraw_parental_consent(pg_temp.ceid(20)) >= 1,'3 the parent withdraws for sibling one');
SELECT pg_temp.cecheck(pg_temp.ceseen(20)='none','3 after withdrawal, that child''s events are gone',pg_temp.ceseen(20));
SELECT pg_temp.cecheck(pg_temp.ceseen(22)='602','3 the other child''s events stay',pg_temp.ceseen(22));
RESET ROLE;
SELECT pg_temp.cecheck(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='child_events' AND p.pronamespace='public'::regnamespace
  AND (pg_get_function_result(p.oid) ILIKE '%notes%' OR pg_get_function_result(p.oid) ILIKE '%SETOF%')),
  '3 the function returns named columns, never the coach''s notes');
SELECT pg_temp.cecheck(NOT has_function_privilege('anon','public.child_events(uuid)','EXECUTE'),'3 anonymous cannot call it');

DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.ce_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.ce_results;
 IF n <> 14 THEN RAISE EXCEPTION 'Child events: % checks ran; expected exactly 14', n; END IF;
 IF failures IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE='Child events failed',DETAIL=failures; END IF;
 RAISE NOTICE 'Child events: % checks passed',n;
END $$;
ROLLBACK;

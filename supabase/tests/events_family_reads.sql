-- @trak-suite mode=--events-reads in-all=true
-- TRAK-125 (J8.2): events belong to the coach's squad and academy; families
-- read them only with active consent (G1, G3, G6). A player or parent reads a
-- published event only through a squad row with that coach, in the event's
-- academy, while the child's consent is active. Drafts stay coach-only. The
-- database owns the academy and the change counter; a published event is
-- cancelled, never deleted or turned back into a draft. Every statement and
-- readback runs through a catching helper, so on a database without this
-- migration the suite lists each failing rule instead of stopping at the
-- first missing column. Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing events-reads fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.e82id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('98200000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE e82_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON e82_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.e82actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.e82id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.e82check(ok boolean,label text,detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.e82_results VALUES(label,ok IS TRUE,detail)
$$;
-- A boolean query, run as the current role. An error is a failure, not an abort.
CREATE FUNCTION pg_temp.e82is(query text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ok boolean; msg text;
BEGIN
 BEGIN EXECUTE query INTO ok;
 EXCEPTION WHEN OTHERS THEN msg := SQLSTATE||': '||SQLERRM;
 END;
 INSERT INTO pg_temp.e82_results VALUES(label, ok IS TRUE, msg);
END $$;
-- The statement must succeed and touch exactly expected_rows rows.
CREATE FUNCTION pg_temp.e82allowed(statement text, label text, expected_rows bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.e82_results VALUES(label, st IS NULL AND n = expected_rows, coalesce(st||': '||msg,'affected rows='||n));
END $$;
-- The statement must fail with exactly this SQLSTATE, or touch zero rows when
-- the state is 'zero-rows'.
CREATE FUNCTION pg_temp.e82refused(statement text, label text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.e82_results VALUES(label,
  CASE WHEN expected = 'zero-rows' THEN st IS NULL AND n = 0 ELSE st IS NOT DISTINCT FROM expected END,
  coalesce(st||': '||msg,'affected rows='||n));
END $$;
-- The suite's events the caller can read, by the last three digits of the id.
SET LOCAL check_function_bodies = off;
CREATE FUNCTION pg_temp.e82seen() RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(right(id::text,3), ',' ORDER BY id),'none')
 FROM public.coach_calendar_events WHERE id::text LIKE '98200000-%'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.e82seen() TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy X (100): coach A (10) and coach B (11), two squads.
-- Academy Y (101): coach Y (12).
-- Child 20 on A's squad, parent 30. Child 21 on B's squad, parent 31.
-- Child 22 on Y's squad, parent 32. Adult 23 on A's squad, row marked
-- coach_departed (needs no consent, so only the departure hides events).
-- Parent 35 has no linked child.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.e82id(n),'synthetic-'||n||'@events82.invalid',now()
 FROM unnest(ARRAY[1,2,10,11,12,20,21,22,23,30,31,32,35]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.e82id(1),'club','Admin X'),(pg_temp.e82id(2),'club','Admin Y'),
 (pg_temp.e82id(10),'coach','Coach A'),(pg_temp.e82id(11),'coach','Coach B'),(pg_temp.e82id(12),'coach','Coach Y'),
 (pg_temp.e82id(20),'player','Child A'),(pg_temp.e82id(21),'player','Child B'),
 (pg_temp.e82id(22),'player','Child Y'),(pg_temp.e82id(23),'player','Adult A'),
 (pg_temp.e82id(30),'parent','Parent A'),(pg_temp.e82id(31),'parent','Parent B'),
 (pg_temp.e82id(32),'parent','Parent Y'),(pg_temp.e82id(35),'parent','Parent Unlinked');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.e82id(100),pg_temp.e82id(1),'Events Academy X','E82AX1'),
 (pg_temp.e82id(101),pg_temp.e82id(2),'Events Academy Y','E82AY1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.e82id(10),pg_temp.e82id(100)),(pg_temp.e82id(11),pg_temp.e82id(100)),(pg_temp.e82id(12),pg_temp.e82id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.e82id(20),current_date - interval '10 years'),(pg_temp.e82id(21),current_date - interval '10 years'),
 (pg_temp.e82id(22),current_date - interval '10 years'),(pg_temp.e82id(23),current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.e82id(20),pg_temp.e82id(30)),(pg_temp.e82id(21),pg_temp.e82id(31)),(pg_temp.e82id(22),pg_temp.e82id(32));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id) VALUES
 (pg_temp.e82id(40),pg_temp.e82id(10),'Child A',pg_temp.e82id(20)),
 (pg_temp.e82id(41),pg_temp.e82id(11),'Child B',pg_temp.e82id(21)),
 (pg_temp.e82id(42),pg_temp.e82id(12),'Child Y',pg_temp.e82id(22)),
 (pg_temp.e82id(43),pg_temp.e82id(10),'Adult A',pg_temp.e82id(23));
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.e82id(43);
-- 500 A published, 501 A draft, 502 B published, 503 Y published.
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at,published) VALUES
 (pg_temp.e82id(500),pg_temp.e82id(10),'A training','2026-11-02 16:00+00',true),
 (pg_temp.e82id(501),pg_temp.e82id(10),'A draft','2026-11-03 16:00+00',false),
 (pg_temp.e82id(502),pg_temp.e82id(11),'B training','2026-11-02 16:00+00',true),
 (pg_temp.e82id(503),pg_temp.e82id(12),'Y training','2026-11-02 16:00+00',true);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.e82id(100),'events');

-- Consent through each parent's own RPC, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.e82actor(30);
SELECT public.record_parental_consent(pg_temp.e82id(20),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.e82actor(31);
SELECT public.record_parental_consent(pg_temp.e82id(21),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.e82actor(32);
SELECT public.record_parental_consent(pg_temp.e82id(22),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');

-- ── 1. Who reads what ─────────────────────────────────────────────────────
SELECT pg_temp.e82actor(20); SELECT pg_temp.e82check(pg_temp.e82seen()='500','1 consented child reads their squad''s published event, not the draft or other squads',pg_temp.e82seen());
SELECT pg_temp.e82actor(30); SELECT pg_temp.e82check(pg_temp.e82seen()='500','1 their parent reads the same',pg_temp.e82seen());
SELECT pg_temp.e82actor(21); SELECT pg_temp.e82check(pg_temp.e82seen()='502','1 a child in another squad reads only their own squad''s event',pg_temp.e82seen());
SELECT pg_temp.e82actor(22); SELECT pg_temp.e82check(pg_temp.e82seen()='503','1 a child in another academy reads only their own academy''s event',pg_temp.e82seen());
SELECT pg_temp.e82actor(32); SELECT pg_temp.e82check(pg_temp.e82seen()='503','1 a parent in another academy reads only their own academy''s event',pg_temp.e82seen());
SELECT pg_temp.e82actor(35); SELECT pg_temp.e82check(pg_temp.e82seen()='none','1 a parent with no linked child reads nothing',pg_temp.e82seen());
SELECT pg_temp.e82actor(23); SELECT pg_temp.e82check(pg_temp.e82seen()='none','1 a player whose squad row is coach_departed reads nothing from that coach',pg_temp.e82seen());
SELECT pg_temp.e82actor(10); SELECT pg_temp.e82check(pg_temp.e82seen()='500,501','1 coach A reads own events, draft included',pg_temp.e82seen());
SELECT pg_temp.e82actor(12); SELECT pg_temp.e82check(pg_temp.e82seen()='503','1 coach Y reads only own events',pg_temp.e82seen());

-- ── 2. Coach A writes: the database owns academy and change counter ───────
SELECT pg_temp.e82actor(10);
SELECT pg_temp.e82allowed(format(
 'INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,opponent,meet_time,kit,home_away,organization_id,sequence)
  VALUES(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,99)',
 pg_temp.e82id(520),pg_temp.e82id(10),'A match','match','2026-11-07 09:00+00','Synthetic Rovers','08:15','White','away',pg_temp.e82id(101)),
 '2 coach A creates a match with meet time, kit and home/away',1);
RESET ROLE;
SELECT pg_temp.e82is(format('SELECT organization_id=%L AND sequence=0 AND status=''scheduled'' AND NOT published
  AND meet_time=''08:15'' AND kit=''White'' AND home_away=''away'' FROM public.coach_calendar_events WHERE id=%L',
 pg_temp.e82id(100),pg_temp.e82id(520)),'2 a new event is a scheduled draft in the coach''s academy at sequence 0, whatever the app sent');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e82actor(10);
SELECT pg_temp.e82allowed(format('UPDATE public.coach_calendar_events SET organization_id=%L, sequence=0 WHERE id=%L',pg_temp.e82id(101),pg_temp.e82id(520)),'2 coach A sends an academy and counter on edit',1);
SELECT pg_temp.e82allowed(format('UPDATE public.coach_calendar_events SET published=true WHERE id=%L',pg_temp.e82id(520)),'2 coach A publishes',1);
SELECT pg_temp.e82allowed(format('UPDATE public.coach_calendar_events SET status=''cancelled'', cancel_reason=''Pitch closed'' WHERE id=%L',pg_temp.e82id(520)),'2 coach A cancels',1);
SELECT pg_temp.e82refused(format('UPDATE public.coach_calendar_events SET status=''deleted'' WHERE id=%L',pg_temp.e82id(520)),'2 an unknown status is refused','23514');
SELECT pg_temp.e82refused(format('UPDATE public.coach_calendar_events SET home_away=''neutral'' WHERE id=%L',pg_temp.e82id(520)),'2 an unknown home/away is refused','23514');
-- 500 exists with or without this migration, so these can't pass vacuously.
SELECT pg_temp.e82refused(format('UPDATE public.coach_calendar_events SET published=false WHERE id=%L',pg_temp.e82id(500)),'2 a published event cannot go back to draft','42501');
SELECT pg_temp.e82refused(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.e82id(500)),'2 a published event cannot be deleted','zero-rows');
SELECT pg_temp.e82allowed(format('DELETE FROM public.coach_calendar_events WHERE id=%L',pg_temp.e82id(501)),'2 a draft can be deleted',1);
RESET ROLE;
SELECT pg_temp.e82is(format('SELECT organization_id=%L AND sequence=3 AND published AND status=''cancelled'' AND cancel_reason=''Pitch closed''
  FROM public.coach_calendar_events WHERE id=%L',pg_temp.e82id(100),pg_temp.e82id(520)),
 '2 readback: the cancel kept the row, academy pinned, counter bumped once per accepted edit');
SELECT pg_temp.e82check(NOT EXISTS(SELECT 1 FROM public.coach_calendar_events WHERE id=pg_temp.e82id(501)),'2 readback: the draft is gone');

-- ── 3. Families see the cancellation; a coach's move doesn't leak events ──
SET LOCAL ROLE authenticated;
SELECT pg_temp.e82actor(30); SELECT pg_temp.e82check(pg_temp.e82seen()='500,520','3 the parent reads the cancelled match, not only scheduled ones',pg_temp.e82seen());
RESET ROLE;
-- Coach A moves to academy Y. Their old squad rows stay in X, so an event
-- made in Y is not read through them.
UPDATE public.coach_details SET organization_id=pg_temp.e82id(101) WHERE user_id=pg_temp.e82id(10);
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,starts_at,published)
 VALUES(pg_temp.e82id(530),pg_temp.e82id(10),'A training in Y','2026-11-09 16:00+00',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.e82actor(20); SELECT pg_temp.e82check(pg_temp.e82seen()='500,520','3 a child in academy X does not read their coach''s event made in academy Y',pg_temp.e82seen());

-- ── 4. Withdrawal hides events on the next request ─────────────────────────
SELECT pg_temp.e82actor(30);
SELECT pg_temp.e82check(public.withdraw_parental_consent(pg_temp.e82id(20)) >= 1,'4 parent A withdraws consent for child A');
SELECT pg_temp.e82check(pg_temp.e82seen()='none','4 after withdrawal the parent reads nothing',pg_temp.e82seen());
SELECT pg_temp.e82actor(20); SELECT pg_temp.e82check(pg_temp.e82seen()='none','4 after withdrawal the child reads nothing',pg_temp.e82seen());
SELECT pg_temp.e82actor(21); SELECT pg_temp.e82check(pg_temp.e82seen()='502','4 another family''s consent still stands',pg_temp.e82seen());
RESET ROLE;
SELECT pg_temp.e82is('SELECT NOT has_function_privilege(''anon'',''trak_private.family_reads_event(uuid,uuid)'',''EXECUTE'')','4 anonymous cannot call the family read helper');

-- ── 5. The academy pin doesn't block deleting an academy ──────────────────
-- ON DELETE SET NULL is an UPDATE the pin sees; putting the old academy back
-- would fail the FK and block the delete (and a club admin's account
-- deletion), as 20260918224500 found for assessments.
SELECT pg_temp.e82allowed(format('DELETE FROM public.organizations WHERE id=%L',pg_temp.e82id(101)),'5 academy Y can be deleted while it has events',1);
SELECT pg_temp.e82is(format('SELECT organization_id IS NULL FROM public.coach_calendar_events WHERE id=%L',pg_temp.e82id(503)),'5 readback: Y''s event lost its academy, so no family reads it');

DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.e82_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.e82_results;
 IF n <> 30 THEN
  RAISE EXCEPTION 'Events reads: % checks ran; expected exactly 30', n;
 END IF;
 IF failures IS NOT NULL THEN
  RAISE EXCEPTION USING MESSAGE='Events reads failed',DETAIL=failures;
 END IF;
 RAISE NOTICE 'Events reads: % checks passed',n;
END $$;
SELECT count(*) AS events_reads_checks_passed FROM pg_temp.e82_results;
ROLLBACK;

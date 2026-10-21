-- @trak-suite mode=--event-emails in-all=true
-- TRAK-135 (J8.12): a cancellation (any date) or a today/tomorrow change to a
-- published event queues one email notice; drafts, publishing and changes
-- further out queue nothing; quick edits join one notice that keeps the
-- first "before". Recipients follow the app's read rule (TRAK-125): consented
-- children on that coach's squad in that academy, and their guardians, once
-- per address, never a username login or .test address. A claimed notice
-- leaves out who already had it, and app roles can't touch any of it.
-- Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing event-emails fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.e135id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('91350000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE e135_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON e135_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.e135actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.e135id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.e135check(ok boolean,label text,detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.e135_results VALUES(label,ok IS TRUE,detail)
$$;
-- The statement must succeed and touch exactly expected_rows rows.
CREATE FUNCTION pg_temp.e135allowed(statement text, label text, expected_rows bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; st text; msg text;
BEGIN
 BEGIN EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.e135_results VALUES(label, st IS NULL AND n = expected_rows, coalesce(st||': '||msg,'affected rows='||n));
END $$;
-- The statement must fail with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.e135refused(statement text, label text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text; msg text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.e135_results VALUES(label, st IS NOT DISTINCT FROM expected, coalesce(st||': '||msg,'no error'));
END $$;
SET LOCAL check_function_bodies = off;
-- The notices for one suite event, as kind/status pairs, oldest first.
CREATE FUNCTION pg_temp.e135notices(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(kind||'/'||status, ',' ORDER BY created_at, status),'none')
 FROM public.event_change_notices WHERE event_id = pg_temp.e135id(n)
$$;
-- Recipients by the last three digits of their id.
CREATE FUNCTION pg_temp.e135to(n integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(right(user_id::text,3), ',' ORDER BY user_id),'none')
 FROM trak_private.event_change_recipients(pg_temp.e135id(n))
$$;
-- A day relative to today in Dubai, and a time on it as a timestamp.
CREATE FUNCTION pg_temp.e135day(k integer) RETURNS date LANGUAGE sql AS $$
 SELECT (now() AT TIME ZONE 'Asia/Dubai')::date + k
$$;
CREATE FUNCTION pg_temp.e135at(k integer, t time) RETURNS timestamptz LANGUAGE sql AS $$
 SELECT (pg_temp.e135day(k) + t) AT TIME ZONE 'Asia/Dubai'
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy X (100): coach A (10, squad U15) and coach B (11).
-- On A's squad: child 20 (own email) and sibling 26 (own email), parent 30
-- of both; child 21 with a username login, parent 31; child 22 whose consent
-- is withdrawn, parent 32; child 24 (own email) whose parent 34 has a .test
-- address; adult 25 on a coach_departed row. Child 23 on B's squad, parent 33.
-- Academy Y (101): where coach A moves at the end (section 5).
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.e135id(n),
  CASE n WHEN 21 THEN 'kid21@child.trakfootball.com' WHEN 34 THEN 'parent34@family.test'
         ELSE 'synthetic-'||n||'@events135.invalid' END, now()
 FROM unnest(ARRAY[1,10,11,20,21,22,23,24,25,26,30,31,32,33,34]) n;
INSERT INTO public.profiles(user_id,role,full_name)
 SELECT pg_temp.e135id(n),
  CASE WHEN n = 1 THEN 'club' WHEN n IN (10,11) THEN 'coach' WHEN n BETWEEN 20 AND 29 THEN 'player' ELSE 'parent' END::public.user_role,
  'Synthetic '||n
 FROM unnest(ARRAY[1,10,11,20,21,22,23,24,25,26,30,31,32,33,34]) n;
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.e135id(100),pg_temp.e135id(1),'Emails Academy X','E135X1'),
 (pg_temp.e135id(101),pg_temp.e135id(1),'Emails Academy Y','E135Y1');
INSERT INTO public.coach_details(user_id,organization_id,team) VALUES
 (pg_temp.e135id(10),pg_temp.e135id(100),'U15'),(pg_temp.e135id(11),pg_temp.e135id(100),'U17');
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.e135id(n), current_date - interval '10 years' FROM unnest(ARRAY[20,21,22,23,24,26]) n;
INSERT INTO public.player_details(user_id,date_of_birth) VALUES (pg_temp.e135id(25), current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.e135id(20),pg_temp.e135id(30)),(pg_temp.e135id(26),pg_temp.e135id(30)),
 (pg_temp.e135id(21),pg_temp.e135id(31)),(pg_temp.e135id(22),pg_temp.e135id(32)),
 (pg_temp.e135id(23),pg_temp.e135id(33)),(pg_temp.e135id(24),pg_temp.e135id(34));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id)
 SELECT pg_temp.e135id(n+20), pg_temp.e135id(CASE WHEN n = 23 THEN 11 ELSE 10 END), 'Synthetic '||n, pg_temp.e135id(n)
 FROM unnest(ARRAY[20,21,22,23,24,25,26]) n;
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.e135id(45);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.e135id(100),'events') ON CONFLICT DO NOTHING;
-- Coach A's events. 600 published in 5 days; 601 published in 5 days;
-- 602 published tomorrow; 603 a draft tomorrow (20:30); 604 published tomorrow (21:30);
-- 603/604 were "today" at 17:00, which failed after 13:00 UTC once a started
-- event became uneditable (TRAK-230);
-- 605 published in 5 days; 606 a draft in 3 days. The three in 5 days have
-- their own times: a coach's live events can't overlap (TRAK-158).
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,end_time,venue,published)
 SELECT pg_temp.e135id(600+i), pg_temp.e135id(10), 'Training '||i, 'training',
  pg_temp.e135at(d, t0), pg_temp.e135day(d), t0, t1, 'Pitch 2', p
 FROM (VALUES (0,5,true,time '17:00',time '18:30'),(1,5,true,time '19:00',time '20:30'),(2,1,true,time '17:00',time '18:30'),
              (3,1,false,time '20:30',time '21:00'),(4,1,true,time '21:30',time '22:00'),(5,5,true,time '15:00',time '16:30'),
              (6,3,false,time '17:00',time '18:30')) v(i,d,p,t0,t1);
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published)
 VALUES (pg_temp.e135id(610),pg_temp.e135id(11),'B training','training',pg_temp.e135at(0,'17:00'),pg_temp.e135day(0),'17:00',true);

-- Consent through each parent's own RPC, the way the app records it; 32 then withdraws.
SET LOCAL ROLE authenticated;
SELECT pg_temp.e135actor(30);
SELECT public.record_parental_consent(pg_temp.e135id(20),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT public.record_parental_consent(pg_temp.e135id(26),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.e135actor(31);
SELECT public.record_parental_consent(pg_temp.e135id(21),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.e135actor(32);
SELECT public.record_parental_consent(pg_temp.e135id(22),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT public.withdraw_parental_consent(pg_temp.e135id(22));
SELECT pg_temp.e135actor(33);
SELECT public.record_parental_consent(pg_temp.e135id(23),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.e135actor(34);
SELECT public.record_parental_consent(pg_temp.e135id(24),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');

-- ── 1. What coach A's edits queue ─────────────────────────────────────────
SELECT pg_temp.e135actor(10);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET status=''cancelled'', cancel_reason=''Pitch closed'' WHERE id=%L',pg_temp.e135id(600)),
 '1 coach A cancels a published event 5 days out',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET start_time=''18:30'', end_time=''20:00'' WHERE id=%L',pg_temp.e135id(601)),
 '1 coach A moves a published event 5 days out',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET start_time=''18:00'' WHERE id=%L',pg_temp.e135id(602)),'1 coach A edits tomorrow''s event (1 of 3)',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET start_time=''18:30'', end_time=''20:00'' WHERE id=%L',pg_temp.e135id(602)),'1 coach A edits tomorrow''s event (2 of 3)',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET venue=''Pitch 4'' WHERE id=%L',pg_temp.e135id(602)),'1 coach A edits tomorrow''s event (3 of 3)',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET status=''cancelled'' WHERE id=%L',pg_temp.e135id(603)),'1 coach A cancels a draft for today',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET title=''Renamed'' WHERE id=%L',pg_temp.e135id(604)),'1 coach A renames today''s event',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET event_date=%L, starts_at=%L WHERE id=%L',
 pg_temp.e135day(1),pg_temp.e135at(1,'15:00'),pg_temp.e135id(605)),'1 coach A moves an event from 5 days out to tomorrow',1);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET published=true WHERE id=%L',pg_temp.e135id(606)),'1 coach A publishes a draft',1);
RESET ROLE;
SELECT pg_temp.e135check(pg_temp.e135notices(600)='cancelled/pending','1 a cancellation 5 days out queues one notice',pg_temp.e135notices(600));
SELECT pg_temp.e135check(pg_temp.e135notices(601)='none','1 a change 5 days out queues nothing',pg_temp.e135notices(601));
SELECT pg_temp.e135check(pg_temp.e135notices(602)='changed/pending','1 three quick edits to tomorrow''s event make one notice',pg_temp.e135notices(602));
SELECT pg_temp.e135check((SELECT before->>'start_time' = '17:00:00' AND before->>'venue' = 'Pitch 2'
  FROM public.event_change_notices WHERE event_id=pg_temp.e135id(602)),
 '1 the notice keeps the event as families last saw it, before the first edit');
SELECT pg_temp.e135check(pg_temp.e135notices(603)='none','1 cancelling a draft queues nothing',pg_temp.e135notices(603));
SELECT pg_temp.e135check(pg_temp.e135notices(604)='none','1 a title change queues nothing',pg_temp.e135notices(604));
SELECT pg_temp.e135check(pg_temp.e135notices(605)='changed/pending','1 moving onto tomorrow queues a notice',pg_temp.e135notices(605));
SELECT pg_temp.e135check(pg_temp.e135notices(606)='none','1 publishing queues nothing',pg_temp.e135notices(606));
SELECT pg_temp.e135check((SELECT before ? 'cancel_reason' AND NOT (before ? 'notes')
  FROM public.event_change_notices WHERE event_id=pg_temp.e135id(600)),'1 a notice carries the cancel reason (scrubbed in the email), never notes');

-- ── 2. Who is emailed ─────────────────────────────────────────────────────
-- 20 and 26 (own emails), their parent 30 once, parent 31 (not their child's
-- username login), child 24 (not their .test parent). Not withdrawn 22 or
-- parent 32, not departed adult 25, not B's family 23/33.
SELECT pg_temp.e135check(pg_temp.e135to(600)='020,024,026,030,031','2 consented children with their own email and their guardians, once each',pg_temp.e135to(600));
SELECT pg_temp.e135check(pg_temp.e135to(610)='023,033','2 coach B''s event goes to B''s family only',pg_temp.e135to(610));
SELECT pg_temp.e135check(pg_temp.e135to(603)='none','2 a draft has no recipients',pg_temp.e135to(603));

-- ── 3. Only the service role sees or claims notices ───────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.e135actor(10);
SELECT pg_temp.e135refused('SELECT count(*) FROM public.event_change_notices','3 a coach cannot read notices','42501');
SELECT pg_temp.e135refused('SELECT public.claim_event_change_notices()','3 a coach cannot claim notices','42501');
SELECT pg_temp.e135refused('INSERT INTO public.event_change_deliveries(notice_id,recipient_user_id) SELECT id, auth.uid() FROM public.event_change_notices','3 a coach cannot record a delivery','42501');
SELECT pg_temp.e135refused(format('SELECT * FROM trak_private.event_change_recipients(%L)',pg_temp.e135id(600)),'3 a coach cannot list recipients','42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.e135refused('SELECT public.claim_event_change_notices()','3 anonymous cannot claim notices','42501');
RESET ROLE;

-- ── 4. Claiming, delivery records and retries ─────────────────────────────
CREATE TEMP TABLE e135_claim(n integer, claimed jsonb);
GRANT SELECT, INSERT ON e135_claim TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO e135_claim SELECT 0, public.claim_event_change_notices();
SELECT pg_temp.e135check((SELECT jsonb_array_length(claimed) = 0 FROM e135_claim WHERE n = 0),
 '4 nothing is claimed before its 15 s are up',(SELECT claimed::text FROM e135_claim WHERE n = 0));
SELECT pg_temp.e135check(public.event_change_notices_wait() BETWEEN 14 AND 15,'4 the wait says when the last notice is due',public.event_change_notices_wait()::text);
RESET ROLE;
UPDATE public.event_change_notices SET due_at = now() - interval '1 second';
SET LOCAL ROLE service_role;
INSERT INTO e135_claim SELECT 1, public.claim_event_change_notices();
SELECT pg_temp.e135check((SELECT jsonb_array_length(claimed) = 3 FROM e135_claim WHERE n = 1),
 '4 the three due notices are claimed',(SELECT jsonb_array_length(claimed)::text FROM e135_claim WHERE n = 1));
SELECT pg_temp.e135check((SELECT x->'event'->>'start_time' = '18:30:00' AND x->'event'->>'venue' = 'Pitch 4'
  AND x->'before'->>'start_time' = '17:00:00' AND x->>'squad' = 'U15' AND x->>'academy' = 'Emails Academy X'
  FROM e135_claim, jsonb_array_elements(claimed) x WHERE n = 1 AND x->>'notice_id' =
   (SELECT id::text FROM public.event_change_notices WHERE event_id = pg_temp.e135id(602))),
 '4 a claimed notice has the event now, the event before, the squad and the academy');
SELECT pg_temp.e135check((SELECT jsonb_array_length(x->'recipients') = 5
  FROM e135_claim, jsonb_array_elements(claimed) x WHERE n = 1 AND x->'event'->>'title' = 'Training 0'),
 '4 the cancellation comes with its five recipients');
SELECT pg_temp.e135check((SELECT x->'event'->>'cancel_reason' = 'Pitch closed'
  FROM e135_claim, jsonb_array_elements(claimed) x WHERE n = 1 AND x->'event'->>'title' = 'Training 0'),
 '4 a claimed cancellation carries the reason for the email to scrub');
SELECT pg_temp.e135check((SELECT NOT (x->'child_names' ? 'Synthetic 23')
   AND x->'child_names' @> '["Synthetic 20","Synthetic 21","Synthetic 22","Synthetic 24","Synthetic 25","Synthetic 26"]'::jsonb
  FROM e135_claim, jsonb_array_elements(claimed) x WHERE n = 1 AND x->'event'->>'title' = 'Training 0'),
 '4 a claimed notice lists every child on the coach''s squad rows (any academy, departed too), not other coaches''');
INSERT INTO e135_claim SELECT 2, public.claim_event_change_notices();
SELECT pg_temp.e135check((SELECT jsonb_array_length(claimed) = 0 FROM e135_claim WHERE n = 2),'4 a claimed notice is not claimed twice');
-- 600 reached child 20, then failed for the rest.
SELECT public.record_event_change_delivery(ARRAY[(SELECT id FROM public.event_change_notices WHERE event_id = pg_temp.e135id(600))], pg_temp.e135id(20), 'provider-1');
SELECT public.finish_event_change_notice((SELECT id FROM public.event_change_notices WHERE event_id = pg_temp.e135id(600)), 'failed', 4, 'delivery_failed:429');
SELECT pg_temp.e135check(pg_temp.e135notices(600)='cancelled/failed','4 a failed notice stays visible as failed',pg_temp.e135notices(600));
RESET ROLE;
SELECT pg_temp.e135check((SELECT sent_count = 1 AND failed_count = 4 AND last_error = 'delivery_failed:429' AND attempts = 1
  FROM public.event_change_notices WHERE event_id = pg_temp.e135id(600)),'4 readback: counts and reason code, no address');
-- A minute later the failed notice is retried, without the person who had it.
UPDATE public.event_change_notices SET finished_at = now() - interval '2 minutes' WHERE event_id = pg_temp.e135id(600);
SET LOCAL ROLE service_role;
INSERT INTO e135_claim SELECT 3, public.claim_event_change_notices();
SELECT pg_temp.e135check((SELECT jsonb_array_length(claimed) = 1 AND jsonb_array_length(claimed->0->'recipients') = 4
  AND NOT (claimed->0->'recipients' @> jsonb_build_array(jsonb_build_object('user_id', pg_temp.e135id(20))))
  FROM e135_claim WHERE n = 3),'4 the retry leaves out the person who already had it',(SELECT claimed::text FROM e135_claim WHERE n = 3));
SELECT pg_temp.e135refused(format('SELECT public.finish_event_change_notice(%L, ''deleted'', 0, null)',
 (SELECT id FROM public.event_change_notices WHERE event_id = pg_temp.e135id(600))),'4 an unknown outcome is refused','22023');
RESET ROLE;
-- An edit while 602's email is going out queues a new notice for after it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.e135actor(10);
SELECT pg_temp.e135allowed(format('UPDATE public.coach_calendar_events SET start_time=''19:00'' WHERE id=%L',pg_temp.e135id(602)),'4 coach A edits again while the email goes out',1);
RESET ROLE;
SELECT pg_temp.e135check(pg_temp.e135notices(602)='changed/pending,changed/sending','4 the new edit gets its own notice',pg_temp.e135notices(602));

-- ── 5. The academy half of the rule (Tarek, #264) ─────────────────────────
-- Coach A moves to academy Y; their squad rows stay in X. An event A
-- publishes in Y and then cancels emails nobody: no X family reads it.
UPDATE public.coach_details SET organization_id=pg_temp.e135id(101) WHERE user_id=pg_temp.e135id(10);
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published,organization_id)
 VALUES (pg_temp.e135id(620),pg_temp.e135id(10),'Y training','training',pg_temp.e135at(0,'20:00'),pg_temp.e135day(0),'20:00',true,pg_temp.e135id(101));
SELECT pg_temp.e135check((SELECT organization_id = pg_temp.e135id(101) FROM public.coach_calendar_events WHERE id = pg_temp.e135id(620))
  AND pg_temp.e135to(620) = 'none' AND pg_temp.e135to(600) = '020,024,026,030,031',
 '5 coach A''s event in academy Y emails none of their academy X families',pg_temp.e135to(620));

DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.e135_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.e135_results;
 IF n <> 41 THEN
  RAISE EXCEPTION 'Event emails: % checks ran; expected exactly 41', n;
 END IF;
 IF failures IS NOT NULL THEN
  RAISE EXCEPTION USING MESSAGE='Event emails failed',DETAIL=failures;
 END IF;
 RAISE NOTICE 'Event emails: % checks passed',n;
END $$;
SELECT count(*) AS event_emails_checks_passed FROM pg_temp.e135_results;
ROLLBACK;

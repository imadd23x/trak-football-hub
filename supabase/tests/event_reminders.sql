-- @trak-suite mode=--event-reminders in-all=true
-- TRAK-136 (J8.13): one reminder email per person per day, 2 days before
-- (Dubai), listing every published, scheduled event they may read (J8.12's
-- recipient rule: consent, the coach's squad in the event's academy, never a
-- username login or .test address), across all their children. Settings can
-- turn it off; cancelled events and drafts are left out; a claim never hands
-- out the same person and day twice, a failure is retried at most 3 times
-- and stays visible, and app roles can't touch the sends. The scheduler is
-- only installed where pg_cron and pg_net exist, so this disposable database
-- has neither and the migration still applies.
-- Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing event-reminder fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.r136id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('91360000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE r136_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON r136_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.r136actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.r136id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.r136check(ok boolean,label text,detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.r136_results VALUES(label,ok IS TRUE,detail)
$$;
CREATE FUNCTION pg_temp.r136refused(statement text, label text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text; msg text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM;
 END;
 INSERT INTO pg_temp.r136_results VALUES(label, st IS NOT DISTINCT FROM expected, coalesce(st||': '||msg,'no error'));
END $$;
CREATE FUNCTION pg_temp.r136day(k integer) RETURNS date LANGUAGE sql AS $$
 SELECT (now() AT TIME ZONE 'Asia/Dubai')::date + k
$$;
CREATE FUNCTION pg_temp.r136at(k integer, t time) RETURNS timestamptz LANGUAGE sql AS $$
 SELECT (pg_temp.r136day(k) + t) AT TIME ZONE 'Asia/Dubai'
$$;
SET LOCAL check_function_bodies = off;
-- Who is due a reminder for a day, and for which events, by the last three digits.
CREATE FUNCTION pg_temp.r136due(k integer) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(right(user_id::text,3)||':'||evs, ',' ORDER BY user_id),'none') FROM (
  SELECT d.user_id, string_agg(right(d.event_id::text,3), '+' ORDER BY d.event_id) AS evs
  FROM trak_private.event_reminder_due(pg_temp.r136day(k)) d GROUP BY d.user_id) x
$$;
-- A claim's people, as user:event-count, by the last three digits.
CREATE FUNCTION pg_temp.r136people(claimed jsonb) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(right(x->>'user_id',3)||':'||jsonb_array_length(x->'events'), ',' ORDER BY x->>'user_id'),'none')
 FROM jsonb_array_elements(claimed) x
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Academy X (100): coach A (10, U15) and coach B (11, U17).
-- On A's squad: child 20 (own email) and sibling 26 (own email), parent 30 of
-- both, who is also parent of 27 on B's squad (two children, two squads);
-- child 21 with a username login, parent 31, who turns reminders off; child 22
-- whose consent is withdrawn, parent 32; adult 25 on a coach_departed row.
-- Child 23 on B's squad, parent 33.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.r136id(n),
  CASE n WHEN 21 THEN 'kid21@child.trakfootball.com' ELSE 'synthetic-'||n||'@reminders136.invalid' END, now()
 FROM unnest(ARRAY[1,10,11,20,21,22,23,25,26,27,30,31,32,33]) n;
INSERT INTO public.profiles(user_id,role,full_name)
 SELECT pg_temp.r136id(n),
  CASE WHEN n = 1 THEN 'club' WHEN n IN (10,11) THEN 'coach' WHEN n BETWEEN 20 AND 29 THEN 'player' ELSE 'parent' END::public.user_role,
  'Synthetic '||n
 FROM unnest(ARRAY[1,10,11,20,21,22,23,25,26,27,30,31,32,33]) n;
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.r136id(100),pg_temp.r136id(1),'Reminders Academy X','R136X1');
INSERT INTO public.coach_details(user_id,organization_id,team) VALUES
 (pg_temp.r136id(10),pg_temp.r136id(100),'U15'),(pg_temp.r136id(11),pg_temp.r136id(100),'U17');
INSERT INTO public.player_details(user_id,date_of_birth)
 SELECT pg_temp.r136id(n), current_date - interval '10 years' FROM unnest(ARRAY[20,21,22,23,26,27]) n;
INSERT INTO public.player_details(user_id,date_of_birth) VALUES (pg_temp.r136id(25), current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES
 (pg_temp.r136id(20),pg_temp.r136id(30)),(pg_temp.r136id(26),pg_temp.r136id(30)),(pg_temp.r136id(27),pg_temp.r136id(30)),
 (pg_temp.r136id(21),pg_temp.r136id(31)),(pg_temp.r136id(22),pg_temp.r136id(32)),(pg_temp.r136id(23),pg_temp.r136id(33));
INSERT INTO public.squad_players(id,coach_user_id,player_name,linked_player_id)
 SELECT pg_temp.r136id(n+20), pg_temp.r136id(CASE WHEN n IN (23,27) THEN 11 ELSE 10 END), 'Synthetic '||n, pg_temp.r136id(n)
 FROM unnest(ARRAY[20,21,22,23,25,26,27]) n;
UPDATE public.squad_players SET status='coach_departed' WHERE id=pg_temp.r136id(45);
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.r136id(100),'events') ON CONFLICT DO NOTHING;
-- Events. In 2 days: A's training 700 and match 701 (published, at 17:00 and
-- 19:00: a coach's live events can't overlap, TRAK-158), A's cancelled 702,
-- A's draft 703, B's training 710. In 3 days: A's 704. Tomorrow: A's 705
-- (not today: a started event can't be cancelled, TRAK-230, so a 17:00 "today" failed after 13:00 UTC).
INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,venue,published,status)
 SELECT pg_temp.r136id(id), pg_temp.r136id(coach), 'Reminder '||id, kind,
  pg_temp.r136at(d, CASE WHEN id = 701 THEN time '19:00' ELSE time '17:00' END), pg_temp.r136day(d),
  CASE WHEN id = 701 THEN time '19:00' ELSE time '17:00' END, 'Pitch 2', pub, st
 FROM (VALUES (700,10,'training',2,true,'scheduled'),(701,10,'match',2,true,'scheduled'),
              (702,10,'training',2,true,'cancelled'),(703,10,'training',2,false,'scheduled'),
              (710,11,'training',2,true,'scheduled'),(704,10,'training',3,true,'scheduled'),
              (705,10,'training',1,true,'scheduled')) v(id,coach,kind,d,pub,st);

-- Consent through each parent's own RPC; 32 then withdraws.
SET LOCAL ROLE authenticated;
SELECT pg_temp.r136actor(30);
SELECT public.record_parental_consent(pg_temp.r136id(c),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.')
 FROM unnest(ARRAY[20,26,27]) c;
SELECT pg_temp.r136actor(31);
SELECT public.record_parental_consent(pg_temp.r136id(21),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT pg_temp.r136actor(32);
SELECT public.record_parental_consent(pg_temp.r136id(22),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');
SELECT public.withdraw_parental_consent(pg_temp.r136id(22));
SELECT pg_temp.r136actor(33);
SELECT public.record_parental_consent(pg_temp.r136id(23),'parent','{"coaching_records":true}'::jsonb,'synthetic-v1','Synthetic disposable consent.');

-- ── 1. Settings: reminders are on unless the person turns them off ────────
SELECT pg_temp.r136actor(31);
SELECT pg_temp.r136check((SELECT count(*) FROM public.notification_settings) = 0,'1 nobody has a row until they choose: reminders are on by default');
INSERT INTO public.notification_settings(user_id, event_reminders) VALUES (pg_temp.r136id(31), false);
SELECT pg_temp.r136check((SELECT NOT event_reminders FROM public.notification_settings WHERE user_id = pg_temp.r136id(31)),'1 a parent turns their reminders off');
SELECT pg_temp.r136refused(format('INSERT INTO public.notification_settings(user_id, event_reminders) VALUES (%L, false)', pg_temp.r136id(30)),
 '1 a parent cannot turn off someone else''s reminders','42501');
SELECT pg_temp.r136actor(30);
SELECT pg_temp.r136check((SELECT count(*) FROM public.notification_settings) = 0,'1 a parent cannot read someone else''s setting');
-- No filter: only the update policy stands between this and everyone's row.
UPDATE public.notification_settings SET event_reminders = true;
RESET ROLE;
SELECT pg_temp.r136check((SELECT NOT event_reminders FROM public.notification_settings WHERE user_id = pg_temp.r136id(31)),
 '1 a parent cannot switch someone else''s reminders back on');

-- ── 2. Who is due, for which events ───────────────────────────────────────
-- 2 days out: 20 and 26 (A's two events), parent 30 once with A's two and
-- B's one (two children, two squads), 23, 27 and 33 (B's). Not 31 (off), not 21
-- (username login), not 22/32 (withdrawn), not departed 25; never the
-- cancelled 702 or the draft 703.
SELECT pg_temp.r136check(pg_temp.r136due(2) = '020:700+701,023:710,026:700+701,027:710,030:700+701+710,033:710',
 '2 two days out: every consented person once, with all their children''s events',pg_temp.r136due(2));
SELECT pg_temp.r136check(pg_temp.r136due(3) = '020:704,026:704,030:704','2 another day lists only that day''s events',pg_temp.r136due(3));

-- ── 3. Claiming: once per person and day; failures are retried, visibly ──
CREATE TEMP TABLE r136_claim(n integer, claimed jsonb);
GRANT SELECT, INSERT ON r136_claim TO service_role;
SET LOCAL ROLE service_role;
-- No day given, as send-event-reminders calls it: 2 days ahead on the
-- academy's clock (Dubai here), at noon so the sending hours are open (TRAK-175).
INSERT INTO r136_claim SELECT 1, public.claim_event_reminders(NULL, pg_temp.r136at(0, '12:00'));
SELECT pg_temp.r136check((SELECT pg_temp.r136people(claimed) = '020:2,023:1,026:2,027:1,030:3,033:1' FROM r136_claim WHERE n = 1),
 '3 the claim hands out one email per person, grouped',(SELECT pg_temp.r136people(claimed) FROM r136_claim WHERE n = 1));
SELECT pg_temp.r136check((SELECT x->>'email' = 'synthetic-30@reminders136.invalid'
   AND (SELECT string_agg(e->>'event_type', ',' ORDER BY e->>'event_type') FROM jsonb_array_elements(x->'events') e) = 'match,training,training'
   AND x->'events'->0 ? 'child_names' AND x->'events'->0 ? 'squad'
  FROM r136_claim, jsonb_array_elements(claimed) x WHERE n = 1 AND right(x->>'user_id',3) = '030'),
 '3 a claimed person comes with their address and each event''s fields, squad and child names');
INSERT INTO r136_claim SELECT 2, public.claim_event_reminders(pg_temp.r136day(2));
SELECT pg_temp.r136check((SELECT jsonb_array_length(claimed) = 0 FROM r136_claim WHERE n = 2),'3 a second claim for the same day hands out nobody: no double send');
SELECT public.finish_event_reminder(pg_temp.r136id(20), pg_temp.r136day(2), 'sent', 2, 'provider-20', NULL);
SELECT public.finish_event_reminder(pg_temp.r136id(30), pg_temp.r136day(2), 'failed', 0, NULL, 'delivery_failed:429');
RESET ROLE;
SELECT pg_temp.r136check((SELECT status = 'sent' AND event_count = 2 AND provider_id = 'provider-20' AND attempts = 1
  FROM public.event_reminder_sends WHERE user_id = pg_temp.r136id(20) AND reminder_day = pg_temp.r136day(2)),'3 readback: a sent reminder is recorded');
SELECT pg_temp.r136check((SELECT status = 'failed' AND last_error = 'delivery_failed:429'
  FROM public.event_reminder_sends WHERE user_id = pg_temp.r136id(30) AND reminder_day = pg_temp.r136day(2)),'3 readback: a failure stays visible with a reason code, no address');
-- A minute later the failure is retried; the sent one never is.
UPDATE public.event_reminder_sends SET finished_at = now() - interval '2 minutes' WHERE user_id = pg_temp.r136id(30);
SET LOCAL ROLE service_role;
INSERT INTO r136_claim SELECT 3, public.claim_event_reminders(pg_temp.r136day(2));
SELECT pg_temp.r136check((SELECT pg_temp.r136people(claimed) = '030:3' FROM r136_claim WHERE n = 3),
 '3 a failed reminder is retried a minute later, alone',(SELECT pg_temp.r136people(claimed) FROM r136_claim WHERE n = 3));
SELECT public.finish_event_reminder(pg_temp.r136id(30), pg_temp.r136day(2), 'failed', 0, NULL, 'delivery_failed:500');
RESET ROLE;
UPDATE public.event_reminder_sends SET attempts = 3, finished_at = now() - interval '2 minutes' WHERE user_id = pg_temp.r136id(30);
-- A "sending" one whose function died is taken back after 10 minutes.
UPDATE public.event_reminder_sends SET claimed_at = now() - interval '11 minutes' WHERE user_id = pg_temp.r136id(23);
SET LOCAL ROLE service_role;
INSERT INTO r136_claim SELECT 4, public.claim_event_reminders(pg_temp.r136day(2));
SELECT pg_temp.r136check((SELECT pg_temp.r136people(claimed) = '023:1' FROM r136_claim WHERE n = 4),
 '3 after 3 tries a failure stays failed; a stuck send is taken back',(SELECT pg_temp.r136people(claimed) FROM r136_claim WHERE n = 4));
SELECT pg_temp.r136refused(format('SELECT public.finish_event_reminder(%L, %L, ''deleted'', 0, NULL, NULL)', pg_temp.r136id(23), pg_temp.r136day(2)),
 '3 an unknown outcome is refused','22023');
RESET ROLE;

-- ── 4. When the scheduler should call (no pg_cron needed to test) ────────
-- Reminders go out between 09:00 and 20:00 Dubai, only while someone is due.
SELECT pg_temp.r136check(trak_private.event_reminder_work_due(pg_temp.r136at(0, '12:00')) IS FALSE,
 '4 nobody left unsent for 2 days out (23 is sending, 30 failed for good): no call');
SELECT pg_temp.r136check(trak_private.event_reminder_work_due(pg_temp.r136at(1, '12:00')) IS TRUE,
 '4 tomorrow at noon, 3 days out is due: call');
SELECT pg_temp.r136check(trak_private.event_reminder_work_due(pg_temp.r136at(1, '07:00')) IS FALSE,
 '4 not before 09:00 Dubai');
SELECT pg_temp.r136check(trak_private.event_reminder_work_due(pg_temp.r136at(1, '21:00')) IS FALSE,
 '4 not after 20:00 Dubai');
-- J8.12's sweep: only when a change email is due, failed and retryable, or stuck.
SELECT pg_temp.r136check(trak_private.event_change_work_due() IS FALSE,'4 no change email waiting: the sweep does not call');
SET LOCAL ROLE authenticated;
SELECT pg_temp.r136actor(10);
UPDATE public.coach_calendar_events SET status = 'cancelled' WHERE id = pg_temp.r136id(705);
RESET ROLE;
UPDATE public.event_change_notices SET due_at = now() - interval '1 second';
SELECT pg_temp.r136check(trak_private.event_change_work_due() IS TRUE,'4 a cancellation email due and unsent: the sweep calls');
UPDATE public.event_change_notices SET status = 'sending', claimed_at = now() - interval '1 minute';
SELECT pg_temp.r136check(trak_private.event_change_work_due() IS FALSE,'4 a change email being sent right now: the sweep waits');
UPDATE public.event_change_notices SET claimed_at = now() - interval '11 minutes';
SELECT pg_temp.r136check(trak_private.event_change_work_due() IS TRUE,'4 a change email stuck sending for 10 minutes: the sweep calls');

-- ── 5. App roles can't touch the sends or the scheduler's helpers ────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.r136actor(30);
SELECT pg_temp.r136refused('SELECT count(*) FROM public.event_reminder_sends','5 a parent cannot read reminder sends','42501');
SELECT pg_temp.r136refused(format('SELECT public.claim_event_reminders(%L)', pg_temp.r136day(2)),'5 a parent cannot claim reminders','42501');
SELECT pg_temp.r136refused('SELECT trak_private.event_reminder_work_due()','5 a parent cannot call the scheduler''s checks','42501');
SELECT pg_temp.r136refused('SELECT trak_private.call_trak_function(''send-event-reminders'')','5 a parent cannot make the database call a function','42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.r136refused('SELECT count(*) FROM public.notification_settings','5 signed-out visitors cannot read settings','42501');
RESET ROLE;
SELECT pg_temp.r136refused('SELECT trak_private.call_trak_function(''send-roster-invites'')','5 the database calls only the two scheduled functions','22023');
-- A Vault value pasted with a trailing line break or slash still makes the right address.
SELECT pg_temp.r136check(trak_private.scheduled_function_url(E'https://x.supabase.co/functions/v1\n', 'send-event-reminders') = 'https://x.supabase.co/functions/v1/send-event-reminders','5 a Vault address with a trailing line break still calls the right function');
SELECT pg_temp.r136check(trak_private.scheduled_function_url(E' https://x.supabase.co/functions/v1/ \r\n', 'send-event-emails') = 'https://x.supabase.co/functions/v1/send-event-emails','5 a Vault address with spaces and a trailing slash still calls the right function');
-- No pg_cron here, so no schedule: the migration applied without it.
SELECT pg_temp.r136check(NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'),'5 without pg_cron the migration applies and schedules nothing');

DO $$ DECLARE failures text; n integer; BEGIN
 SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.r136_results WHERE ok IS DISTINCT FROM true;
 SELECT count(*) INTO n FROM pg_temp.r136_results;
 IF n <> 32 THEN
  RAISE EXCEPTION 'Event reminders: % checks ran; expected exactly 32', n;
 END IF;
 IF failures IS NOT NULL THEN
  RAISE EXCEPTION USING MESSAGE='Event reminders failed',DETAIL=failures;
 END IF;
 RAISE NOTICE 'Event reminders: % checks passed',n;
END $$;
SELECT count(*) AS event_reminder_checks_passed FROM pg_temp.r136_results;
ROLLBACK;

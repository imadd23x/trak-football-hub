-- @trak-suite mode=--own-absence-review in-all=true
-- TRAK-183 (J8.14 follow-up, Imad 15 Oct): a player who consents for
-- themselves (at or above their academy's consent age, TRAK-177) says "Can't
-- make it" for their own events, as a guardian does. Under that age a guardian
-- still reports, even when consent is in place. One player never reports for
-- another. Every other check of absence_target stays. Synthetic records, real
-- roles, disposable database only; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing own-absence fixtures outside a disposable database';
  END IF;
END $$;
CREATE FUNCTION pg_temp.oa(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('98183000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE oa_results(label text, ok boolean, detail text);
GRANT INSERT ON oa_results TO authenticated;
CREATE FUNCTION pg_temp.oa_as(n integer) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.oa(n))::text, true)::text
$$;
CREATE FUNCTION pg_temp.oa_check(ok boolean, label text, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO pg_temp.oa_results VALUES(label, ok IS TRUE, detail)
$$;
CREATE FUNCTION pg_temp.oa_ok(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN msg := SQLSTATE||': '||SQLERRM; END;
  INSERT INTO pg_temp.oa_results VALUES(label, msg IS NULL, msg);
END $$;
CREATE FUNCTION pg_temp.oa_refused(statement text, label text, words text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text; msg text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; msg := SQLERRM; END;
  INSERT INTO pg_temp.oa_results VALUES(label, st = '42501' AND msg ILIKE '%'||words||'%', coalesce(st||': '||msg,'unexpectedly succeeded'));
END $$;
CREATE FUNCTION pg_temp.oa_report(event integer, child integer) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.report_cant_make_it(%L, %L, %L)', pg_temp.oa(event), pg_temp.oa(child), 'school')
$$;
CREATE FUNCTION pg_temp.oa_undo(event integer, child integer) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.undo_cant_make_it(%L, %L)', pg_temp.oa(event), pg_temp.oa(child))
$$;
-- Absences the caller can read, as event-suffix:child-suffix pairs.
SET LOCAL check_function_bodies = off;
CREATE FUNCTION pg_temp.oa_seen() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(a.event_id::text,3)||':'||right(sp.linked_player_id::text,2), ',' ORDER BY a.event_id, sp.linked_player_id),'none')
  FROM public.event_absences a JOIN public.squad_players sp ON sp.id = a.squad_player_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.oa_seen() TO authenticated;

-- Greek academy 100 (consent age 15): admin 1, coach 3. UAE academy 101
-- (18): admin 2, coach 4. Players: 10 Greek 16 (consents for themselves),
-- 11 Greek 14 (guardian 20 consented), 12 UAE 18 (needs nobody), 13 Greek 16
-- (consents for themselves), 14 Greek 16 (has not chosen yet).
INSERT INTO auth.users(id, email, email_confirmed_at)
  SELECT pg_temp.oa(n), 'own-absence-' || n || '@synthetic.invalid', now() FROM unnest(ARRAY[1,2,3,4,10,11,12,13,14,20]) n;
INSERT INTO public.profiles(user_id, role, full_name) VALUES
  (pg_temp.oa(1),'club','Greek Admin'),(pg_temp.oa(2),'club','UAE Admin'),
  (pg_temp.oa(3),'coach','Greek Coach'),(pg_temp.oa(4),'coach','UAE Coach'),
  (pg_temp.oa(10),'player','Greek Sixteen'),(pg_temp.oa(11),'player','Greek Fourteen'),
  (pg_temp.oa(12),'player','UAE Eighteen'),(pg_temp.oa(13),'player','Greek Sixteen Too'),
  (pg_temp.oa(14),'player','Greek Undecided'),(pg_temp.oa(20),'parent','Guardian');
INSERT INTO public.organizations(id, admin_user_id, name, join_code) VALUES
  (pg_temp.oa(100), pg_temp.oa(1), 'Own Absence GR', 'OA183G'),
  (pg_temp.oa(101), pg_temp.oa(2), 'Own Absence AE', 'OA183A');
-- Trak (an operator) sets the Greek academy to 15.
UPDATE public.organizations SET consent_age = 15 WHERE id = pg_temp.oa(100);
INSERT INTO public.academy_features(organization_id, feature) VALUES (pg_temp.oa(100),'events'), (pg_temp.oa(101),'events') ON CONFLICT DO NOTHING;
INSERT INTO public.coach_details(user_id, organization_id) VALUES (pg_temp.oa(3), pg_temp.oa(100)), (pg_temp.oa(4), pg_temp.oa(101));
INSERT INTO public.player_details(user_id, date_of_birth) VALUES
  (pg_temp.oa(10), (current_date - interval '16 years 1 month')::date),
  (pg_temp.oa(11), (current_date - interval '14 years 1 month')::date),
  (pg_temp.oa(12), (current_date - interval '18 years 1 month')::date),
  (pg_temp.oa(13), (current_date - interval '16 years 1 month')::date),
  (pg_temp.oa(14), (current_date - interval '16 years 1 month')::date);
INSERT INTO public.player_parent_links(player_user_id, parent_user_id) VALUES (pg_temp.oa(11), pg_temp.oa(20));
INSERT INTO public.squad_players(id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.oa(30), pg_temp.oa(3), 'Greek Sixteen',     pg_temp.oa(10)),
  (pg_temp.oa(31), pg_temp.oa(3), 'Greek Fourteen',    pg_temp.oa(11)),
  (pg_temp.oa(32), pg_temp.oa(4), 'UAE Eighteen',      pg_temp.oa(12)),
  (pg_temp.oa(33), pg_temp.oa(3), 'Greek Sixteen Too', pg_temp.oa(13)),
  (pg_temp.oa(34), pg_temp.oa(3), 'Greek Undecided',   pg_temp.oa(14));
-- 800 the Greek coach's future training; 801 the UAE coach's.
INSERT INTO public.coach_calendar_events(id, coach_user_id, title, starts_at, event_date, start_time, published) VALUES
  (pg_temp.oa(800), pg_temp.oa(3), 'GR training', now() + interval '2 days',
   (now() AT TIME ZONE 'Asia/Dubai' + interval '2 days')::date, (now() AT TIME ZONE 'Asia/Dubai')::time, true),
  (pg_temp.oa(801), pg_temp.oa(4), 'AE training', now() + interval '2 days',
   (now() AT TIME ZONE 'Asia/Dubai' + interval '2 days')::date, (now() AT TIME ZONE 'Asia/Dubai')::time, true);

SET LOCAL ROLE authenticated;
SELECT pg_temp.oa_as(10);
SELECT public.give_my_consent('synthetic-own', 'I agree to my coaching records being kept.');
SELECT pg_temp.oa_as(13);
SELECT public.give_my_consent('synthetic-own', 'I agree to my coaching records being kept.');
SELECT pg_temp.oa_as(20);
SELECT public.record_parental_consent(pg_temp.oa(11), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');

-- ── 1. A player who consents for themselves reports, reads it and undoes ──
SELECT pg_temp.oa_as(10);
SELECT pg_temp.oa_ok(pg_temp.oa_report(800,10), '1 a 16-year-old at a consent-age-15 academy says they can''t make it');
SELECT pg_temp.oa_check(pg_temp.oa_seen() = '800:10', '1 they read their own absence', pg_temp.oa_seen());
SELECT pg_temp.oa_ok(pg_temp.oa_undo(800,10), '1 and undo it');
SELECT pg_temp.oa_check(pg_temp.oa_seen() = 'none', '1 the undone absence is gone', pg_temp.oa_seen());
SELECT pg_temp.oa_ok(pg_temp.oa_report(800,10), '1 they report again (kept for the checks below)');
SELECT pg_temp.oa_as(12);
SELECT pg_temp.oa_ok(pg_temp.oa_report(801,12), '1 an 18-year-old at a consent-age-18 academy reports too');

-- ── 2. Refused ──────────────────────────────────────────────────────────────
SELECT pg_temp.oa_as(11);
SELECT pg_temp.oa_refused(pg_temp.oa_report(800,11), '2 a 14-year-old there is refused, consent or not: a guardian reports', 'guardian');
SELECT pg_temp.oa_as(13);
SELECT pg_temp.oa_refused(pg_temp.oa_report(800,10), '2 one player cannot report another', 'guardian');
SELECT pg_temp.oa_refused(pg_temp.oa_undo(800,10), '2 nor undo another''s', 'guardian');
SELECT pg_temp.oa_check(pg_temp.oa_seen() = 'none', '2 nor read another player''s absence', pg_temp.oa_seen());
-- Counted on event_absences alone: oa_seen() joins the roster, whose RLS would hide a leaked row (Tarek, #318).
SELECT pg_temp.oa_check((SELECT count(*) FROM public.event_absences) = 0, '2 not even as a bare row', (SELECT count(*) FROM public.event_absences)::text);
SELECT pg_temp.oa_as(14);
SELECT pg_temp.oa_refused(pg_temp.oa_report(800,14), '2 old enough but not yet consented: nothing is recorded', 'consent');
SELECT pg_temp.oa_as(10);
SELECT pg_temp.oa_refused(pg_temp.oa_report(801,10), '2 another academy''s event is refused', 'not available');

-- ── 3. The guardian path and the coach are unchanged ───────────────────────
SELECT pg_temp.oa_as(20);
SELECT pg_temp.oa_ok(pg_temp.oa_report(800,11), '3 a guardian still reports their 14-year-old');
SELECT pg_temp.oa_as(11);
SELECT pg_temp.oa_check(pg_temp.oa_seen() = 'none', '3 a 14-year-old reads no absences (their guardian does)', pg_temp.oa_seen());
SELECT pg_temp.oa_as(3);
SELECT pg_temp.oa_check(pg_temp.oa_seen() = '800:10,800:11', '3 the coach sees the player''s own report and the guardian''s', pg_temp.oa_seen());
RESET ROLE;
SELECT pg_temp.oa_check((SELECT reported_by = pg_temp.oa(10) AND reason = 'school' FROM public.event_absences
  WHERE event_id = pg_temp.oa(800) AND squad_player_id = pg_temp.oa(30)), '3 readback: the player is recorded as the reporter');

DO $$ DECLARE failures text; n integer; BEGIN
  SELECT string_agg(label||coalesce(': '||detail,''),E'\n') INTO failures FROM pg_temp.oa_results WHERE ok IS DISTINCT FROM true;
  SELECT count(*) INTO n FROM pg_temp.oa_results;
  IF n <> 17 THEN RAISE EXCEPTION 'Own absences: % checks ran; expected exactly 17', n; END IF;
  IF failures IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE='Own absences failed',DETAIL=failures; END IF;
  RAISE NOTICE 'Own absences: % checks passed', n;
END $$;
ROLLBACK;

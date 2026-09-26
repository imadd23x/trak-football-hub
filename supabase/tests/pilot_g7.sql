-- @trak-suite mode=--pilot-g7-review in-all=true
-- G7 closes deferred media/AI capabilities; manual coaching and account rights
-- remain available. Synthetic fixtures run only on the disposable SQL harness.
-- SQL SELECT tests cover the RLS gate used by Storage list/read/sign, not the
-- Storage HTTP service or already-issued signed URLs.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing G7 fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.g7id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('97070000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
CREATE TEMP TABLE g7_results (description text, passed boolean, detail text);
GRANT INSERT ON g7_results TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.g7assert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.g7_results VALUES (description, ok IS TRUE, detail);
END;
$$;
-- Unexpected success is rolled back, so a missing guard cannot contaminate
-- later assertions. Only 42501 is a denial; invalid SQL is always a failure.
CREATE FUNCTION pg_temp.g7denied(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE denied boolean := false; detail text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION USING ERRCODE = 'ZG701', MESSAGE = 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN denied := true;
    WHEN SQLSTATE 'ZG701' THEN NULL;
    WHEN raise_exception THEN detail := 'Old RPC guard reached: ' || SQLERRM;
  END;
  PERFORM pg_temp.g7assert(denied, description, detail);
END;
$$;
CREATE FUNCTION pg_temp.g7nochange(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected bigint;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'ZG701', MESSAGE = 'unexpectedly changed rows';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN affected := 0;
    WHEN SQLSTATE 'ZG701' THEN affected := 1;
  END;
  PERFORM pg_temp.g7assert(affected = 0, description);
END;
$$;
CREATE FUNCTION pg_temp.g7actor(n integer) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', pg_temp.g7id(n))::text, true)::text;
$$;
-- A fixture-only privileged caller proves that checking current_user alone
-- would miss an application role invoking a SECURITY DEFINER profile writer.
CREATE FUNCTION pg_temp.g7definer_photo(p_user_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.profiles SET avatar_url = 'https://definer.invalid/new.png' WHERE user_id = p_user_id
$$;

-- The minimal platform bootstrap intentionally lacks Storage grants. Supply
-- the actual application privilege boundary here; otherwise every denial would
-- pass before evaluating a policy. These grants and policies roll back.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
CREATE POLICY "G7 test overlapping storage allow" ON storage.objects
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
INSERT INTO storage.buckets (id, name, public) VALUES ('g7-control', 'g7-control', false);
INSERT INTO storage.objects (id, bucket_id, name, owner) VALUES
  (pg_temp.g7id(500), 'avatars', pg_temp.g7id(20)::text, pg_temp.g7id(20)),
  (pg_temp.g7id(501), 'avatars', pg_temp.g7id(10)::text || '/legacy.png', pg_temp.g7id(10)),
  (pg_temp.g7id(502), 'g7-control', 'existing.txt', pg_temp.g7id(20));
SELECT pg_temp.g7assert((SELECT public IS FALSE FROM storage.buckets WHERE id = 'avatars'),
  'avatars bucket remains private');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.g7id(10), 'coach@g7.test', now()),
  (pg_temp.g7id(20), 'player@g7.test', now()),
  (pg_temp.g7id(21), 'new-player@g7.test', now()),
  (pg_temp.g7id(30), 'parent@g7.test', now());
INSERT INTO public.profiles (user_id, role, full_name, avatar_url) VALUES
  (pg_temp.g7id(10), 'coach', 'G7 Coach', NULL),
  (pg_temp.g7id(20), 'player', 'G7 Player', 'https://historical.invalid/avatar.png'),
  (pg_temp.g7id(30), 'parent', 'G7 Parent', 'https://historical.invalid/parent.png');
INSERT INTO public.player_details (user_id, date_of_birth)
  VALUES (pg_temp.g7id(20), '2000-01-01');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
  VALUES (pg_temp.g7id(20), pg_temp.g7id(30));
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name, status)
  VALUES (pg_temp.g7id(200), pg_temp.g7id(10), pg_temp.g7id(20), 'G7 Player', 'active');
INSERT INTO public.coach_assessments (id, squad_player_id, coach_user_id)
  VALUES (pg_temp.g7id(300), pg_temp.g7id(200), pg_temp.g7id(10));
INSERT INTO public.ai_feedback_drafts (id, squad_player_id, generated_text, created_by)
  VALUES (pg_temp.g7id(400), pg_temp.g7id(200), 'Retained AI draft', pg_temp.g7id(10));
INSERT INTO public.player_feedback (id, squad_player_id, draft_id, published_text, author_user_id)
  VALUES (pg_temp.g7id(401), pg_temp.g7id(200), pg_temp.g7id(400), 'Retained AI publication', pg_temp.g7id(10));

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars') = 0,
  'anonymous list exposes no avatar objects even with an overlapping allow policy');
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE id = pg_temp.g7id(500)) = 0,
  'anonymous exact-key read/sign exposes no avatar object');
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'g7-control') = 1,
  'CONTROL anonymous reads in other buckets still obey their existing allow policy');
SELECT pg_temp.g7denied('INSERT INTO storage.objects (bucket_id, name) VALUES (''avatars'', ''anonymous.png'')',
  'anonymous upload remains denied despite the overlapping allow policy');
SELECT pg_temp.g7nochange(format('UPDATE storage.objects SET name = %L WHERE id = %L', 'anonymous.png', pg_temp.g7id(500)),
  'anonymous avatar replacement denied');
SELECT pg_temp.g7denied('SELECT generated_text FROM public.ai_feedback_drafts', 'anonymous AI draft read denied');
SELECT pg_temp.g7denied('SELECT published_text FROM public.player_feedback', 'anonymous AI publication read denied');
SELECT pg_temp.g7denied(format('SELECT public.publish_player_feedback(%L, %L, NULL)',
  pg_temp.g7id(200), 'anonymous'), 'anonymous legacy publication RPC denied');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.g7actor(20);
SELECT pg_temp.g7assert(auth.uid() = pg_temp.g7id(20), 'CONTROL authenticated identity is the player');
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars') = 0,
  'authenticated list exposes no own or other avatar objects');
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE name = auth.uid()::text AND bucket_id = 'avatars') = 0,
  'authenticated own-key read/sign exposes no avatar object');
SELECT pg_temp.g7denied(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
  'avatars', pg_temp.g7id(20)::text, pg_temp.g7id(20)), 'own avatar upload denied');
SELECT pg_temp.g7denied(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
  'avatars', pg_temp.g7id(20)::text || '/new.png', pg_temp.g7id(20)), 'legacy nested avatar upload denied');
SELECT pg_temp.g7nochange(format('UPDATE storage.objects SET name = %L WHERE id = %L', 'replacement.png', pg_temp.g7id(500)),
  'own avatar replacement denied');
SELECT pg_temp.g7nochange(format('UPDATE storage.objects SET bucket_id = %L WHERE id = %L', 'g7-control', pg_temp.g7id(500)),
  'avatar cannot be moved into a readable bucket');
SELECT pg_temp.g7denied(format('UPDATE storage.objects SET bucket_id = %L WHERE id = %L', 'avatars', pg_temp.g7id(502)),
  'another bucket cannot be used to write into avatars');
INSERT INTO storage.objects (id, bucket_id, name, owner)
  VALUES (pg_temp.g7id(503), 'g7-control', 'new.txt', pg_temp.g7id(20));
UPDATE storage.objects SET name = 'updated.txt' WHERE id = pg_temp.g7id(503);
SELECT pg_temp.g7assert((SELECT name FROM storage.objects WHERE id = pg_temp.g7id(503)) = 'updated.txt',
  'CONTROL other bucket insert/update/read still succeeds');
DELETE FROM storage.objects WHERE id = pg_temp.g7id(503);
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE id = pg_temp.g7id(503)) = 0,
  'CONTROL other bucket deletion still succeeds');

SELECT pg_temp.g7denied(format('UPDATE public.profiles SET avatar_url = %L WHERE user_id = %L',
  'https://external.invalid/new.png', pg_temp.g7id(20)), 'external photo-link update denied');
SELECT pg_temp.g7denied(format('UPDATE public.profiles SET avatar_url = %L WHERE user_id = %L',
  pg_temp.g7id(20)::text, pg_temp.g7id(20)), 'storage-key photo update denied');
SELECT pg_temp.g7denied(format('SELECT pg_temp.g7definer_photo(%L)', pg_temp.g7id(20)),
  'SECURITY DEFINER profile writer does not bypass the application photo boundary');
UPDATE public.profiles SET avatar_url = avatar_url WHERE user_id = pg_temp.g7id(20);
UPDATE public.profiles SET full_name = 'G7 Edited Player' WHERE user_id = pg_temp.g7id(20);
SELECT pg_temp.g7assert((SELECT full_name = 'G7 Edited Player' AND avatar_url = 'https://historical.invalid/avatar.png'
  FROM public.profiles WHERE user_id = pg_temp.g7id(20)), 'CONTROL unrelated edits preserve historical avatar values');
SELECT pg_temp.g7assert(public.export_my_account()->'profile'->>'full_name' = 'G7 Edited Player',
  'CONTROL account export still returns the caller profile');
UPDATE public.profiles SET avatar_url = NULL WHERE user_id = pg_temp.g7id(20);
SELECT pg_temp.g7assert((SELECT avatar_url IS NULL FROM public.profiles WHERE user_id = pg_temp.g7id(20)),
  'CONTROL player may clear a historical photo link');
SELECT pg_temp.g7actor(21);
SELECT pg_temp.g7denied(format('INSERT INTO public.profiles (user_id, role, full_name, avatar_url) VALUES (%L, %L, %L, %L)',
  pg_temp.g7id(21), 'player', 'New Player', 'data:image/png;base64,photo'), 'new profile cannot insert a non-null photo');
SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', 'New Player'));
SELECT pg_temp.g7assert((SELECT avatar_url IS NULL FROM public.profiles WHERE user_id = pg_temp.g7id(21)),
  'CONTROL ordinary signup still provisions a profile');
SELECT public.delete_my_account();
RESET ROLE;
SELECT pg_temp.g7assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = pg_temp.g7id(21)),
  'CONTROL account deletion still removes the account');

-- Every application role loses the AI tables, including the author/owner.
SET LOCAL ROLE authenticated;
SELECT pg_temp.g7actor(10);
SELECT pg_temp.g7denied('SELECT generated_text FROM public.ai_feedback_drafts', 'owning coach AI draft read denied');
SELECT pg_temp.g7denied('SELECT published_text FROM public.player_feedback', 'owning coach AI publication read denied');
SELECT pg_temp.g7denied(format('INSERT INTO public.ai_feedback_drafts (squad_player_id, generated_text, created_by) VALUES (%L, %L, %L)',
  pg_temp.g7id(200), 'new draft', pg_temp.g7id(10)), 'owning coach AI draft write denied');
SELECT pg_temp.g7denied('UPDATE public.ai_feedback_drafts SET generated_text = ''replacement''', 'AI draft update denied');
SELECT pg_temp.g7denied('DELETE FROM public.ai_feedback_drafts', 'AI draft delete denied');
SELECT pg_temp.g7denied(format('INSERT INTO public.player_feedback (squad_player_id, published_text, author_user_id, revision, superseded_at) VALUES (%L, %L, %L, 2, now())',
  pg_temp.g7id(200), 'bypass', pg_temp.g7id(10)), 'AI publication insert denied');
SELECT pg_temp.g7denied('UPDATE public.player_feedback SET published_text = ''replacement''', 'AI publication update denied');
SELECT pg_temp.g7denied('DELETE FROM public.player_feedback', 'AI publication delete denied');
SELECT pg_temp.g7denied(format('SELECT public.publish_player_feedback(%L, %L, %L)',
  pg_temp.g7id(200), 'approve retained draft', pg_temp.g7id(400)), 'owning coach cannot publish a retained AI draft');
SELECT pg_temp.g7denied(format('SELECT public.publish_player_feedback(%L, %L, NULL)',
  pg_temp.g7id(200), 'alternate entry'), 'null draft cannot reopen the legacy publication API');

INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at)
  VALUES (pg_temp.g7id(300), pg_temp.g7id(10), 'Manual coach words', NULL);
SELECT pg_temp.g7actor(20);
SELECT pg_temp.g7assert((SELECT count(*) FROM public.coach_shared_feedback WHERE assessment_id = pg_temp.g7id(300)) = 0,
  'manual unpublished words remain private');
SELECT pg_temp.g7denied('SELECT published_text FROM public.player_feedback', 'player cannot read retained AI publications');
SELECT pg_temp.g7actor(10);
UPDATE public.coach_shared_feedback SET published_at = now() WHERE assessment_id = pg_temp.g7id(300);
SELECT pg_temp.g7actor(20);
SELECT pg_temp.g7assert((SELECT body FROM public.coach_shared_feedback WHERE assessment_id = pg_temp.g7id(300)) = 'Manual coach words',
  'CONTROL coach can publish manual words and player can read them');
SELECT pg_temp.g7actor(30);
SELECT pg_temp.g7assert((SELECT count(*) FROM public.coach_assessments WHERE id = pg_temp.g7id(300)) = 1,
  'CONTROL linked parent still reads the assessment (the bands)');
SELECT pg_temp.g7assert((SELECT count(*) FROM public.coach_shared_feedback WHERE assessment_id = pg_temp.g7id(300)) = 0,
  'TRAK-15: linked parent does not read the published manual message');
SELECT pg_temp.g7denied('SELECT generated_text FROM public.ai_feedback_drafts', 'parent cannot read retained AI drafts');
SELECT pg_temp.g7denied('SELECT published_text FROM public.player_feedback', 'parent cannot read retained AI publications');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role', 'sub', pg_temp.g7id(10))::text, true);
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars') = 2,
  'CONTROL trusted maintenance still sees retained avatar objects');
DELETE FROM storage.objects WHERE id = pg_temp.g7id(500);
SELECT pg_temp.g7assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars') = 1,
  'CONTROL trusted avatar cleanup still works');
UPDATE public.profiles SET avatar_url = NULL WHERE user_id = pg_temp.g7id(30);
SELECT pg_temp.g7assert((SELECT avatar_url IS NULL FROM public.profiles WHERE user_id = pg_temp.g7id(30)),
  'CONTROL trusted maintenance can clear a retained profile link');
SELECT pg_temp.g7assert((SELECT count(*) FROM public.ai_feedback_drafts) = 1
  AND (SELECT count(*) FROM public.player_feedback) = 1,
  'CONTROL retained AI records remain available to trusted maintenance');
-- Even a trusted call/accidental future EXECUTE grant cannot run the old
-- SECURITY DEFINER publisher; cleanup uses table operations instead.
SELECT pg_temp.g7denied(format('SELECT public.publish_player_feedback(%L, %L, NULL)',
  pg_temp.g7id(200), 'must remain inert'), 'publication RPC implementation itself is inert');

RESET ROLE;
DO $test$
DECLARE failures text;
BEGIN
  SELECT string_agg(description || coalesce(': ' || detail, ''), E'\n' ORDER BY description)
    INTO failures FROM pg_temp.g7_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'G7 capability boundary failed', DETAIL = failures;
  END IF;
END;
$test$;
SELECT count(*) AS pilot_g7_assertions FROM g7_results;
ROLLBACK;

-- @trak-suite mode=--account-avatar-review in-all=true
BEGIN;
DO $$ BEGIN
 IF current_setting('trak.test_database',true) IS DISTINCT FROM 'disposable' THEN RAISE EXCEPTION 'Disposable database required'; END IF;
END $$;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
CREATE TEMP TABLE avatar_checks(label text, pass boolean);
GRANT INSERT ON avatar_checks TO authenticated;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('98300000-0000-0000-0000-000000000001','avatar-live@test.invalid',now()),
 ('98300000-0000-0000-0000-000000000002','avatar-deleted@test.invalid',now());
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 ('98300000-0000-0000-0000-000000000001','parent','Synthetic Live Parent'),
 ('98300000-0000-0000-0000-000000000002','parent','Synthetic Deleted Parent');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"98300000-0000-0000-0000-000000000001"}',true);
INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','98300000-0000-0000-0000-000000000001');
INSERT INTO avatar_checks VALUES('live owner can upload',true);
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM public.delete_my_account(); EXCEPTION WHEN SQLSTATE '55000' THEN refused:=true; END;
 INSERT INTO avatar_checks VALUES('account deletion refuses an outstanding avatar',refused);
END $$;
RESET ROLE;
INSERT INTO avatar_checks SELECT 'blocked deletion preserves Auth and profile',
 EXISTS(SELECT 1 FROM auth.users WHERE id='98300000-0000-0000-0000-000000000001') AND
 EXISTS(SELECT 1 FROM public.profiles WHERE user_id='98300000-0000-0000-0000-000000000001');
-- Simulate Storage API metadata completion in this disposable SQL-only harness.
-- This is not byte deletion and is never run against hosted Storage.
DELETE FROM storage.objects WHERE bucket_id='avatars' AND name='98300000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.delete_my_account();
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"98300000-0000-0000-0000-000000000002"}',true);
SELECT public.delete_my_account();
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','98300000-0000-0000-0000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 INSERT INTO avatar_checks VALUES('pre-deletion JWT cannot recreate an avatar',refused);
END $$;
RESET ROLE;
-- Storage tests permissions in a rolled-back user transaction, then persists
-- metadata using elevated privileges. RLS alone does not govern that phase.
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('avatars','98300000-0000-0000-0000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 INSERT INTO avatar_checks VALUES('elevated Storage completion cannot recreate deleted-account metadata',refused);
END $$;
INSERT INTO avatar_checks SELECT 'both Auth accounts removed after no-object deletion',
 NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN('98300000-0000-0000-0000-000000000001','98300000-0000-0000-0000-000000000002'));
DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(label, '; ') INTO failures FROM avatar_checks WHERE NOT pass;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Avatar lifecycle failed: %',failures; END IF;
END $$;
ROLLBACK;

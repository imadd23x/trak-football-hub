-- Storage probes RLS in a rolled-back transaction, then completes the upload
-- with elevated privileges. Enforce account existence at that final write too.
-- Derive the account from the owned object key, not request JWT settings: the
-- elevated connection need not carry the original caller's claims.
CREATE OR REPLACE FUNCTION trak_storage.guard_avatar_account_at_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_text text; avatar_owner uuid;
BEGIN
  IF NEW.bucket_id <> 'avatars' THEN RETURN NEW; END IF;
  owner_text := split_part(NEW.name, '/', 1);
  IF owner_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Avatar object requires an account key' USING ERRCODE='42501';
  END IF;
  avatar_owner := owner_text::uuid;
  PERFORM 1 FROM auth.users WHERE id=avatar_owner FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avatar account no longer exists' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION trak_storage.guard_avatar_account_at_completion() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_avatar_account_at_completion ON storage.objects;
CREATE TRIGGER guard_avatar_account_at_completion
 BEFORE INSERT OR UPDATE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION trak_storage.guard_avatar_account_at_completion();

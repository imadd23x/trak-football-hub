-- G7: the first pilot offers manual coaching, without photos or AI feedback.
-- This is a forward capability boundary, independent of the deployed UI.
-- Historical objects/links/AI records are retained for reviewed maintenance;
-- there is no data deletion or change to account export/deletion here.

-- A private bucket alone still allows authenticated reads and signed URLs
-- through a SELECT policy. Restrictive policies are ANDed with all permissive
-- policies, including an own-avatar policy that another migration may add.
-- No global storage grants or policies on unrelated buckets are changed.
UPDATE storage.buckets SET public = false WHERE id = 'avatars';

DROP POLICY IF EXISTS "Pilot disables avatar reads" ON storage.objects;
CREATE POLICY "Pilot disables avatar reads" ON storage.objects
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (bucket_id <> 'avatars');

DROP POLICY IF EXISTS "Pilot disables avatar uploads" ON storage.objects;
CREATE POLICY "Pilot disables avatar uploads" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id <> 'avatars');

DROP POLICY IF EXISTS "Pilot disables avatar changes" ON storage.objects;
CREATE POLICY "Pilot disables avatar changes" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id <> 'avatars')
  WITH CHECK (bucket_id <> 'avatars');

-- Storage RLS cannot revoke signed URLs already issued. Their remaining
-- lifetime, any external historical links, and cached content are release
-- follow-ups. Trusted service-role cleanup still bypasses storage RLS.

CREATE OR REPLACE FUNCTION public.guard_pilot_avatar_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  -- current_setting('role') retains the calling SET ROLE identity inside a
  -- SECURITY DEFINER RPC; current_user also covers direct role connections.
  -- Neither check trusts a user-controlled JWT metadata claim.
  IF (current_user IN ('anon', 'authenticated')
      OR current_setting('role', true) IN ('anon', 'authenticated'))
     AND NEW.avatar_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PILOT_FEATURE_DISABLED: profile photos are unavailable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_pilot_avatar_write ON public.profiles;
CREATE TRIGGER guard_pilot_avatar_write
  BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_pilot_avatar_write();
REVOKE ALL ON FUNCTION public.guard_pilot_avatar_write() FROM PUBLIC, anon, authenticated;

-- These are the deferred AI workflow's tables, not coach_shared_feedback.
-- Remove their allow policies as well as grants, keeping grant/policy parity
-- and default-deny if a future migration accidentally restores a table grant.
DO $migration$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('ai_feedback_drafts', 'player_feedback')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END;
$migration$;
REVOKE ALL ON TABLE public.ai_feedback_drafts, public.player_feedback
  FROM PUBLIC, anon, authenticated;

-- Table RLS/grants do not constrain the old SECURITY DEFINER publisher.
-- Keep its signature for older clients, remove its elevated execution and
-- make its body inert before any record read, lock, or write. NULL draft_id
-- must not become a second manual-publication API; that remains the separate
-- coach_shared_feedback path.
CREATE OR REPLACE FUNCTION public.publish_player_feedback(
  p_squad_player_id uuid,
  p_text text,
  p_draft_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PILOT_FEATURE_DISABLED: AI feedback publication is unavailable';
END;
$function$;
REVOKE ALL ON FUNCTION public.publish_player_feedback(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- Leave coach_shared_feedback, its consent checks, export_my_account(), and
-- delete_my_account() unchanged. service_role keeps maintenance privileges on
-- retained data; application roles keep normal profile reads and non-photo edits.

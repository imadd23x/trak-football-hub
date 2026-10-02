-- Avatar objects are readable by anyone, signed out, on the live project.
--
-- A private bucket still applies its SELECT policies to LIST and to signing, so
-- `public = false` (20260526000006) closed only the /object/public/ route. The
-- "Avatars are publicly readable" policy (20260424000003) FOR SELECT TO public
-- was never dropped, and the object key is the owner's user_id, so any caller
-- holding the anon key could enumerate the bucket and mint a signed URL for any
-- object. Measured against production on 2026-09-22 as anon: LIST returned every
-- object name, SIGN on an unowned object returned a URL, GET returned the image.
--
-- The owner DELETE policy tested (storage.foldername(name))[1], which is NULL for
-- the flat key the uploader writes (Settings.tsx sets name = auth.uid()), so the
-- predicate could never be true: no owner could delete their own photo, and
-- delete_my_account() therefore left avatar objects behind. That is not an
-- omission in the RPC -- no path could delete them.
--
-- Audience: own-only, decided by Tarek on 2026-09-22. All five avatar render
-- sites read the signed-in user's own profile (Settings, ClubProfile,
-- CoachProfilePage, ParentProfilePage, PlayerProfilePage), so own-only breaks no
-- screen today and can be widened when a screen needs another user's photo.
-- Narrowing after real photos exist is the risky direction.
--
-- Scope: the read/delete policy repair only. The concurrent upload/deletion
-- finalization race is deliberately not addressed here so that this fix is not
-- held behind it.
BEGIN;

DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own avatar" ON storage.objects;
CREATE POLICY "Users can read own avatar"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND name = auth.uid()::text);

-- Accept the flat key the uploader writes, and keep deletion of an older
-- own-folder object working, without granting either across users or buckets.
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      name = auth.uid()::text
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

COMMIT;

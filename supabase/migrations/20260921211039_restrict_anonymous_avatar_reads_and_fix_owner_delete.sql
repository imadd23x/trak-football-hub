-- A private bucket still applies its SELECT policies to signing and listing.
-- The original TO public policy let anonymous callers mint signed avatar URLs.
-- Keep the existing authenticated audience; narrowing related-role visibility
-- is a separate product decision, not part of this anonymous-access repair.
BEGIN;

DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read avatars" ON storage.objects;
CREATE POLICY "Authenticated users can read avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- Settings uploads to a bare user UUID. Preserve deletion of older own-folder
-- objects too, without granting deletion of another user's key or another bucket.
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

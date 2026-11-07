-- Avatar uploads fail on web and iOS with
--   StorageApiError: new row violates row-level security policy
-- on POST /storage/v1/object/avatars/<auth.uid()>/avatar-<ts>.jpg (2026-11-07).
--
-- The bucket exists and is private, and the client writes to
-- `<auth.uid()>/avatar-<timestamp>.jpg` exactly as the 2026-07-03 policies
-- expect. The live storage.objects policies for the avatars bucket therefore
-- no longer match the ones in this repository. This migration restores them.
--
-- Live DB inspection (2026-11-07) showed the avatars write policies had been
-- replaced OUTSIDE this repository by "... by profile id" variants that key the
-- folder on profiles.id, while the app (imageUpload.ts, settings.ts and the
-- request_account_deletion() RPC) consistently keys it on auth.uid(). Those
-- drifted policies are removed here so the restored auth.uid() ones apply.
--
-- Idempotent and scoped: it only touches the avatars policies and leaves
-- every other bucket's policies untouched. Dropping and recreating a policy in
-- one transaction does not affect stored files.

DROP POLICY IF EXISTS "Users upload own avatar by profile id" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar by profile id" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatar by profile id" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated can view avatars" ON storage.objects;
CREATE POLICY "Authenticated can view avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

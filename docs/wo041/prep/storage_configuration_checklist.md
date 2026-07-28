# Storage Configuration Checklist (Production)

Two buckets are used at launch. Both are **private** — reads require
an authenticated session; there are no public buckets.

## `avatars`

| Property | Required value |
|---|---|
| Bucket id / name | `avatars` |
| Public | `false` |
| Allowed MIME types | `image/png`, `image/jpeg`, `image/webp`, `image/gif` (image/*) |
| Max size | 5 MB (recommended) |
| Path convention | `<auth.uid()>/<filename>` — first folder must equal the caller's `auth.uid()` |
| Anonymous read | Denied (no `anon` policy) |
| Authenticated read | Allowed via `Authenticated can view avatars` |
| Cross-user overwrite | Denied — INSERT/UPDATE/DELETE require `(storage.foldername(name))[1] = auth.uid()::text` |
| Deleted-user cleanup | Avatars purged by `request_account_deletion` finalization; see WO-040 Batch 3 (DEF-B3-03) |
| Signed URLs | Not required — authenticated fetch is used |

### Policies expected after migrations

```sql
-- SELECT
CREATE POLICY "Authenticated can view avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- INSERT
CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars'
              AND (storage.foldername(name))[1] = auth.uid()::text);

-- UPDATE
CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = auth.uid()::text);

-- DELETE
CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = auth.uid()::text);
```

## `meetup-covers`

| Property | Required value |
|---|---|
| Bucket id / name | `meetup-covers` |
| Public | `false` |
| Allowed MIME types | `image/png`, `image/jpeg`, `image/webp` |
| Max size | 8 MB (recommended) |
| Path convention | Owned by uploader (`objects.owner = auth.uid()`) |
| Anonymous read | Denied |
| Authenticated read | Allowed via `Authenticated can view meetup covers` |
| Cross-user overwrite | Denied — UPDATE/DELETE require `owner = auth.uid()` |
| Deleted-user cleanup | Cover URLs stored on `meetups.cover_image_url`; on account deletion, hosted meetups are cancelled and covers become unreachable via UI. Owner may prune periodically. |
| Signed URLs | Not required |

### Policies expected after migrations

```sql
CREATE POLICY "Authenticated can view meetup covers"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'meetup-covers');

CREATE POLICY "Authenticated upload meetup covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meetup-covers');

CREATE POLICY "Users update own meetup cover"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'meetup-covers' AND owner = auth.uid());

CREATE POLICY "Users delete own meetup cover"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meetup-covers' AND owner = auth.uid());
```

## Verification tests

1. **Anon read blocked** — `curl` any object URL without a session → 400/403.
2. **Cross-user overwrite** — user A tries to upload to `<user_B_uid>/foo.png` → RLS denies.
3. **Path traversal** — attempt path `../<user_B_uid>/foo.png` → RLS denies (`storage.foldername` strips leading `..`).
4. **MIME enforcement** — upload `.exe` — bucket rejects (or, if MIME limits are not applied at bucket level, client enforces and RLS still restricts scope).
5. **Owner delete** — user A deletes their own avatar → succeeds. User B cannot delete A's avatar → denied.

All five tests must pass in production before smoke sign-off.

# Smoke Fixture Admin Cleanup — Owner Steps

`smoke_fixture_cleanup.sql` removes only public-schema rows. Auth users
and storage objects require privileged access.

## Prerequisites

- The `RUN_ID` used during the smoke session.
- Owner access to the production Lovable Cloud project.

## 1. Delete smoke auth users

In the Lovable Cloud Users panel:

1. Filter by email pattern: `wo041+*.<RUN_ID>@lovable-smoke.test`.
2. Verify each hit corresponds to a row from
   `SELECT id, email FROM auth.users WHERE email LIKE 'wo041+%.<RUN_ID>@lovable-smoke.test';`
3. Delete each user.
4. Confirm `SELECT count(*) FROM auth.users;` equals 0.

## 2. Delete smoke storage objects

For both `avatars` and `meetup-covers` buckets:

1. In the Storage panel, filter object name for `<RUN_ID>`.
2. Cross-check against
   `SELECT bucket_id, name FROM storage.objects WHERE name LIKE '%<RUN_ID>%';`
3. Delete each object.
4. Confirm `SELECT bucket_id, count(*) FROM storage.objects GROUP BY bucket_id;`
   returns no rows (or all counts are 0).

## 3. Verification after privileged cleanup

Run `post_smoke_cleanup_counts.sql` and confirm:

- Every user-generated table count is 0.
- `cities = 5`, `interest_catalogue = 12`, `community_places = 0`.
- `auth.users = 0`.
- `storage.objects = 0` in every bucket.
- QA/fixture pattern queries return zero rows.

If any check fails, do NOT proceed to public launch — investigate and
re-run the appropriate cleanup step.

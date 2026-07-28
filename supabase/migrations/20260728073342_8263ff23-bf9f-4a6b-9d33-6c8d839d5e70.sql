
-- Column-level REVOKE has no effect while a table-level SELECT grant exists,
-- because Postgres unions column ACLs with the table ACL. Switch to explicit
-- column grants: revoke table-level SELECT, then grant SELECT on every
-- column *except* auth_user_id.
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (
  id,
  display_name,
  bio,
  avatar_url,
  current_city,
  interests,
  is_active_host,
  meetups_hosted_count,
  meetups_attended_count,
  veggies_met_count,
  created_at,
  updated_at,
  onboarding_completed,
  home_city_id,
  dietary_identity,
  pronouns,
  community_guidelines_accepted_at,
  discovery_visible
) ON public.profiles TO authenticated;

-- INSERT/UPDATE/DELETE grants remain (Batch 2 established them). Owners can
-- still update their own auth_user_id via SECURITY DEFINER server paths; they
-- do not need direct client UPDATE of that column.

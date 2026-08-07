-- WO-063A DEF-063A-01: meetup_completions must be read-only to members, invisible to anon.
REVOKE ALL ON public.meetup_completions FROM anon;
REVOKE ALL ON public.meetup_completions FROM PUBLIC;
REVOKE ALL ON public.meetup_completions FROM authenticated;
GRANT SELECT ON public.meetup_completions TO authenticated;
GRANT ALL ON public.meetup_completions TO service_role;

-- WO-063A DEF-063A-02: TRUNCATE bypasses RLS. Remove it from completion-sensitive tables.
REVOKE TRUNCATE ON public.meetups FROM authenticated;
REVOKE TRUNCATE ON public.attendance FROM authenticated;
REVOKE DELETE ON public.attendance FROM authenticated;

-- WO-063A DEF-063A-03: impact counters must not be client-writable.
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE TRUNCATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  display_name,
  bio,
  avatar_url,
  interests,
  pronouns,
  dietary_identity,
  current_city,
  home_city_id,
  discovery_visible,
  is_active_host,
  onboarding_completed,
  community_guidelines_accepted_at,
  updated_at
) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
-- WO-053 QA remediation: the internal owner reason note must never be readable
-- by members or anonymous visitors. Replace the table-wide SELECT grant with a
-- column-level grant that omits status_note and status_changed_by.
-- Owner-only access continues through SECURITY DEFINER maintenance RPCs.

REVOKE SELECT ON public.community_places FROM anon, authenticated;

GRANT SELECT (
  id, name, category, address, cover_image_url, upcoming_meetups_count,
  meetups_this_month, veggies_visited_count, created_at, updated_at, city_id,
  neighborhood, timezone, latitude, longitude, is_active, google_place_id,
  google_maps_url, verification_status, verified_at, verified_by, source,
  business_status, image_rights_status, description, veggie_reason, website_url,
  veggie_classification, maintenance_status, status_changed_at, last_reverified_at
) ON public.community_places TO anon, authenticated;

GRANT ALL ON public.community_places TO service_role;
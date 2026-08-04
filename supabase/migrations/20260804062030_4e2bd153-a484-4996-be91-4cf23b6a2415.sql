REVOKE ALL ON public.community_place_reports FROM anon, authenticated;

-- Members and owners never write this table directly; every mutation goes
-- through submit_community_place_report / moderate_community_place_report.
-- Column-scoped SELECT keeps owner_note, owner_resolution, resolved_by and
-- resolved_at unreadable over the Data API even for signed-in callers.
GRANT SELECT (id, community_place_id, reporter_profile_id, reason_code,
              explanation, official_source_url, additional_details,
              status, created_at, updated_at)
  ON public.community_place_reports TO authenticated;
GRANT ALL ON public.community_place_reports TO service_role;
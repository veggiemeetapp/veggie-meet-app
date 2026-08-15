create or replace function public.get_place_suggestion_queue(_scope text default 'active')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
DECLARE out jsonb; scope text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  scope := lower(coalesce(_scope, 'active'));
  IF scope NOT IN ('active','history') THEN scope := 'active'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'place_name', s.place_name,
    'address_text', s.address_text,
    'official_source_url', s.official_source_url,
    'vegan_reason', s.vegan_reason,
    'submitter_note', s.submitter_note,
    'city_name', c.name,
    'city_id', s.city_id,
    'submitted_at', s.submitted_at,
    'resolved_at', s.reviewed_at,
    'moderation_status', s.moderation_status,
    'rejection_reason', s.rejection_reason,
    'promoted_candidate_id', s.promoted_candidate_id,
    'candidate_status', pc.verification_status,
    'published_place_id', pc.published_place_id,
    'submitter_profile_id', s.submitted_by,
    'possible_duplicate', EXISTS (
      SELECT 1 FROM public.community_places p
       WHERE public._suggestion_norm(p.name) = public._suggestion_norm(s.place_name))
      OR EXISTS (
      SELECT 1 FROM public.place_candidates pc2
       WHERE pc2.id IS DISTINCT FROM s.promoted_candidate_id
         AND public._suggestion_norm(pc2.display_name) = public._suggestion_norm(s.place_name))
  ) ORDER BY
      CASE WHEN scope = 'active'
        THEN CASE s.moderation_status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END
        ELSE 0 END ASC,
      CASE WHEN scope = 'active' THEN s.submitted_at END ASC,
      CASE WHEN scope = 'history' THEN coalesce(s.reviewed_at, s.updated_at, s.submitted_at) END DESC
    ), '[]'::jsonb)
    INTO out
    FROM public.community_place_suggestions s
    LEFT JOIN public.cities c ON c.id = s.city_id
    LEFT JOIN public.place_candidates pc ON pc.id = s.promoted_candidate_id
   WHERE (scope = 'active' AND s.moderation_status IN ('pending','under_review'))
      OR (scope = 'history' AND s.moderation_status NOT IN ('pending','under_review'));
  RETURN out;
END;
$$;

revoke all on function public.get_place_suggestion_queue(text) from public;
revoke all on function public.get_place_suggestion_queue(text) from anon;
grant execute on function public.get_place_suggestion_queue(text) to authenticated;
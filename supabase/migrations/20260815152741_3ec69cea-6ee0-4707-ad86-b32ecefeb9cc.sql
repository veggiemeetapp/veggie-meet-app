-- WO-110 branch-aware duplicate detection ------------------------------------
-- Vietnamese-aware text normalisation helpers.
CREATE OR REPLACE FUNCTION public._place_unaccent(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT translate(
    lower(coalesce(_t, '')),
    'áàảãạăắằẳẵặâấầẩẫậ' || 'éèẻẽẹêếềểễệ' || 'íìỉĩị'
      || 'óòỏõọôốồổỗộơớờởỡợ' || 'úùủũụưứừửữự' || 'ýỳỷỹỵ' || 'đ',
    repeat('a', 17) || repeat('e', 11) || repeat('i', 5)
      || repeat('o', 17) || repeat('u', 11) || repeat('y', 5) || 'd'
  );
$$;

-- Full name key: branch suffixes are intentionally preserved.
CREATE OR REPLACE FUNCTION public._place_name_key(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(public._place_unaccent(_t), '[^a-z0-9]+', '', 'g');
$$;

-- Brand key: branch suffix after a dash is dropped. Warning signal only.
CREATE OR REPLACE FUNCTION public._place_brand_key(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(
    public._place_unaccent(regexp_replace(coalesce(_t, ''), '\s+[-–—]\s+.*$', '')),
    '[^a-z0-9]+', '', 'g');
$$;

-- Canonical address key. Formatting, diacritics, administrative noise words and
-- postal codes are removed so "113-115 Lý Tự Trọng" == "113 115 Ly Tu Trong".
CREATE OR REPLACE FUNCTION public._place_addr_key(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(public._place_unaccent(_t), '[^a-z0-9]+', ' ', 'g'),
        '\y(duong|pho|street|st|road|rd|phuong|ward|quan|district|city|tp|hcm|hcmc|ho|chi|minh|sai|gon|vietnam|viet|nam|vn|floor|tang|lau|hem|no|p|q|d)\y',
        ' ', 'g'),
      '\y[0-9]{5,6}\y', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

REVOKE ALL ON FUNCTION public._place_unaccent(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._place_name_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._place_brand_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._place_addr_key(text) FROM PUBLIC;

-- Duplicate classifier -------------------------------------------------------
-- level: 'hard'      → same physical location, submission refused
--        'possible'  → similar identity, submission allowed, owner reviews
--        'none'
CREATE OR REPLACE FUNCTION public.check_community_place_suggestion_duplicate(
  _city_id uuid,
  _place_name text,
  _address_text text,
  _official_source_url text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nm text; ad text; url text; host text;
  nkey text; bkey text; akey text;
  r record;
BEGIN
  IF public.current_profile_id() IS NULL THEN
    RETURN jsonb_build_object('level', 'none');
  END IF;

  nm  := btrim(regexp_replace(coalesce(_place_name, ''), '\s+', ' ', 'g'));
  ad  := btrim(regexp_replace(coalesce(_address_text, ''), '\s+', ' ', 'g'));
  url := btrim(coalesce(_official_source_url, ''));
  host := regexp_replace(lower(split_part(regexp_replace(url, '^https?://', ''), '/', 1)), '^www\.', '');
  nkey := public._place_name_key(nm);
  bkey := public._place_brand_key(nm);
  akey := public._place_addr_key(ad);

  -- HARD: the same canonical address in the same city is already published.
  SELECT p.id, p.name, p.address INTO r
    FROM public.community_places p
   WHERE p.is_active
     AND p.city_id = _city_id
     AND length(akey) >= 8
     AND public._place_addr_key(p.address) = akey
   LIMIT 1;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'level', 'hard', 'entity_type', 'place', 'match_id', r.id,
      'match_name', r.name, 'match_address', r.address, 'match_status', 'published',
      'published_place_id', r.id,
      'reasons', jsonb_build_array('same_address_same_city'));
  END IF;

  -- HARD: the same canonical address in the same city is already awaiting review.
  SELECT s.id, s.place_name, s.address_text INTO r
    FROM public.community_place_suggestions s
   WHERE s.moderation_status IN ('pending', 'under_review')
     AND s.city_id = _city_id
     AND length(akey) >= 8
     AND public._place_addr_key(s.address_text) = akey
   LIMIT 1;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'level', 'hard', 'entity_type', 'suggestion', 'match_id', r.id,
      'match_name', r.place_name, 'match_address', r.address_text,
      'match_status', 'awaiting_review',
      'reasons', jsonb_build_array('same_address_pending_suggestion'));
  END IF;

  -- POSSIBLE: similar brand identity (name or official website) at a different
  -- address. Never a hard block — legitimate branches live here.
  SELECT p.id, p.name, p.address,
         (public._place_name_key(p.name) = nkey) AS exact_name,
         (public._place_brand_key(p.name) = bkey) AS brand,
         (p.website_url IS NOT NULL AND host <> ''
            AND position(host in lower(p.website_url)) > 0) AS same_host
    INTO r
    FROM public.community_places p
   WHERE p.is_active
     AND (public._place_brand_key(p.name) = bkey
          OR public._place_name_key(p.name) = nkey
          OR (p.website_url IS NOT NULL AND host <> ''
              AND position(host in lower(p.website_url)) > 0))
   ORDER BY (public._place_name_key(p.name) = nkey) DESC
   LIMIT 1;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'level', 'possible', 'entity_type', 'place', 'match_id', r.id,
      'match_name', r.name, 'match_address', r.address, 'match_status', 'published',
      'published_place_id', r.id,
      'reasons', (CASE WHEN r.exact_name OR r.brand THEN jsonb_build_array('similar_name') ELSE '[]'::jsonb END)
                 || (CASE WHEN r.same_host THEN jsonb_build_array('same_official_website') ELSE '[]'::jsonb END));
  END IF;

  SELECT c.id, c.display_name, coalesce(nullif(btrim(c.google_formatted_address), ''), c.district) AS addr,
         c.verification_status,
         (public._place_brand_key(c.display_name) = bkey
          OR public._place_name_key(c.display_name) = nkey) AS brand,
         (c.google_website_url IS NOT NULL AND host <> ''
            AND position(host in lower(c.google_website_url)) > 0) AS same_host
    INTO r
    FROM public.place_candidates c
   WHERE c.verification_status <> 'rejected'
     AND (public._place_brand_key(c.display_name) = bkey
          OR public._place_name_key(c.display_name) = nkey
          OR (c.google_website_url IS NOT NULL AND host <> ''
              AND position(host in lower(c.google_website_url)) > 0))
   LIMIT 1;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'level', 'possible', 'entity_type', 'candidate', 'match_id', r.id,
      'match_name', r.display_name, 'match_address', r.addr,
      'match_status', r.verification_status,
      'reasons', (CASE WHEN r.brand THEN jsonb_build_array('similar_name') ELSE '[]'::jsonb END)
                 || (CASE WHEN r.same_host THEN jsonb_build_array('same_official_website') ELSE '[]'::jsonb END));
  END IF;

  SELECT s.id, s.place_name, s.address_text INTO r
    FROM public.community_place_suggestions s
   WHERE s.moderation_status IN ('pending', 'under_review')
     AND (public._place_brand_key(s.place_name) = bkey
          OR public._place_name_key(s.place_name) = nkey)
   LIMIT 1;
  IF r.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'level', 'possible', 'entity_type', 'suggestion', 'match_id', r.id,
      'match_name', r.place_name, 'match_address', r.address_text,
      'match_status', 'awaiting_review',
      'reasons', jsonb_build_array('similar_name'));
  END IF;

  RETURN jsonb_build_object('level', 'none');
END;
$$;

REVOKE ALL ON FUNCTION public.check_community_place_suggestion_duplicate(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_community_place_suggestion_duplicate(uuid, text, text, text) TO authenticated;

-- Submission -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_community_place_suggestion(
  _city_id uuid,
  _place_name text,
  _address_text text,
  _official_source_url text,
  _vegan_reason text,
  _submitter_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid;
  nm text; ad text; url text; rsn text; note text;
  recent int;
  dup jsonb;
  lvl text;
  new_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  nm   := btrim(regexp_replace(coalesce(_place_name, ''), '\s+', ' ', 'g'));
  ad   := btrim(regexp_replace(coalesce(_address_text, ''), '\s+', ' ', 'g'));
  url  := btrim(coalesce(_official_source_url, ''));
  rsn  := btrim(coalesce(_vegan_reason, ''));
  note := nullif(btrim(coalesce(_submitter_note, '')), '');

  IF nm = '' OR length(nm) > 120
     OR ad = '' OR length(ad) > 240
     OR rsn = '' OR length(rsn) > 600
     OR (note IS NOT NULL AND length(note) > 600)
     OR _city_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  IF url = '' OR length(url) > 500
     OR url !~* '^https?://[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?\.[a-z]{2,}(:[0-9]+)?(/|\?|#|$)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_url');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.community_places
     WHERE city_id = _city_id AND is_active AND verification_status = 'verified'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_city');
  END IF;

  SELECT count(*)::int INTO recent
    FROM public.community_place_suggestions
   WHERE submitted_by = me AND submitted_at > now() - INTERVAL '24 hours';
  IF recent >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'submission_limit_reached');
  END IF;

  dup := public.check_community_place_suggestion_duplicate(_city_id, nm, ad, url);
  lvl := dup->>'level';

  -- Hard duplicates are the same physical location only.
  IF lvl = 'hard' AND dup->>'entity_type' = 'place' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_published_place',
      'match_name', dup->>'match_name', 'published_place_id', dup->>'published_place_id');
  END IF;
  IF lvl = 'hard' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_active_suggestion',
      'match_name', dup->>'match_name');
  END IF;

  INSERT INTO public.community_place_suggestions (
    submitted_by, city_id, place_name, address_text,
    official_source_url, vegan_reason, submitter_note, moderation_status,
    duplicate_of_place_id, duplicate_of_candidate_id, duplicate_of_suggestion_id
  ) VALUES (
    me, _city_id, nm, ad, url, rsn, note, 'pending',
    CASE WHEN lvl = 'possible' AND dup->>'entity_type' = 'place'     THEN (dup->>'match_id')::uuid END,
    CASE WHEN lvl = 'possible' AND dup->>'entity_type' = 'candidate' THEN (dup->>'match_id')::uuid END,
    CASE WHEN lvl = 'possible' AND dup->>'entity_type' = 'suggestion' THEN (dup->>'match_id')::uuid END
  ) RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'success', 'suggestion_id', new_id,
    'possible_duplicate', lvl = 'possible');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_community_place_suggestion(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_community_place_suggestion(uuid, text, text, text, text, text) TO authenticated;

-- Owner review context -------------------------------------------------------
CREATE OR REPLACE FUNCTION public._place_suggestion_match_context(_suggestion_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; r record; reasons jsonb;
BEGIN
  SELECT * INTO s FROM public.community_place_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF s.duplicate_of_place_id IS NOT NULL THEN
    SELECT p.id, p.name, p.address INTO r FROM public.community_places p WHERE p.id = s.duplicate_of_place_id;
    IF r.id IS NOT NULL THEN
      reasons := (CASE WHEN public._place_brand_key(r.name) = public._place_brand_key(s.place_name)
                       THEN jsonb_build_array('Similar name') ELSE '[]'::jsonb END)
                 || (CASE WHEN public._place_addr_key(r.address) = public._place_addr_key(s.address_text)
                       THEN jsonb_build_array('Nearby address') ELSE '[]'::jsonb END);
      IF jsonb_array_length(reasons) = 0 THEN reasons := jsonb_build_array('Same official website'); END IF;
      RETURN jsonb_build_object('entity_type', 'place', 'id', r.id, 'name', r.name,
        'address', r.address, 'status', 'published', 'published_place_id', r.id, 'reasons', reasons);
    END IF;
  END IF;

  IF s.duplicate_of_candidate_id IS NOT NULL THEN
    SELECT c.id, c.display_name, coalesce(nullif(btrim(c.google_formatted_address), ''), c.district) AS addr,
           c.verification_status, c.published_place_id
      INTO r FROM public.place_candidates c WHERE c.id = s.duplicate_of_candidate_id;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object('entity_type', 'candidate', 'id', r.id, 'name', r.display_name,
        'address', r.addr, 'status', r.verification_status,
        'published_place_id', r.published_place_id,
        'reasons', jsonb_build_array('Similar name'));
    END IF;
  END IF;

  IF s.duplicate_of_suggestion_id IS NOT NULL THEN
    SELECT s2.id, s2.place_name, s2.address_text, s2.moderation_status
      INTO r FROM public.community_place_suggestions s2 WHERE s2.id = s.duplicate_of_suggestion_id;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object('entity_type', 'suggestion', 'id', r.id, 'name', r.place_name,
        'address', r.address_text, 'status', r.moderation_status,
        'reasons', jsonb_build_array('Similar name'));
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._place_suggestion_match_context(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_place_suggestion_queue(_scope text DEFAULT 'active')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb; scope text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  scope := lower(coalesce(_scope, 'active'));
  IF scope NOT IN ('active', 'history') THEN scope := 'active'; END IF;

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
    'duplicate_match', public._place_suggestion_match_context(s.id),
    'possible_duplicate', public._place_suggestion_match_context(s.id) IS NOT NULL
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
   WHERE (scope = 'active' AND s.moderation_status IN ('pending', 'under_review'))
      OR (scope = 'history' AND s.moderation_status NOT IN ('pending', 'under_review'));
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_place_suggestion_queue(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_place_suggestion_queue(text) TO authenticated;

-- Promotion: carry the branch-specific address into the candidate and keep the
-- duplicate linkage as review context (never auto-resolved).
CREATE OR REPLACE FUNCTION public.promote_place_suggestion_to_candidate(_suggestion_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; s record; cand_id uuid;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  me := public.current_profile_id();

  SELECT * INTO s FROM public.community_place_suggestions WHERE id = _suggestion_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF s.promoted_candidate_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_promoted');
  END IF;
  IF s.moderation_status NOT IN ('pending', 'under_review') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  INSERT INTO public.place_candidates (
    display_name, district, city_id, source, verification_status,
    veggie_reason, verification_notes, image_rights_status, created_by
  ) VALUES (
    s.place_name, s.address_text, s.city_id, 'community_submitted', 'draft',
    s.vegan_reason,
    'Promoted from community suggestion ' || s.id::text
      || coalesce(E'\nSubmitter note: ' || s.submitter_note, '')
      || E'\nOfficial source: ' || s.official_source_url
      || CASE WHEN s.duplicate_of_place_id IS NOT NULL
                OR s.duplicate_of_candidate_id IS NOT NULL
                OR s.duplicate_of_suggestion_id IS NOT NULL
              THEN E'\nOwner confirmed this is a distinct branch from a similar existing place.'
              ELSE '' END,
    'none', me
  ) RETURNING id INTO cand_id;

  UPDATE public.community_place_suggestions
     SET moderation_status = 'approved',
         promoted_candidate_id = cand_id,
         reviewed_at = now(),
         reviewed_by = me
   WHERE id = _suggestion_id;

  PERFORM public._notify_place_suggestion(s.id, s.submitted_by, s.place_name, 'approved');

  RETURN jsonb_build_object('ok', true, 'reason', 'success', 'candidate_id', cand_id, 'notified', true);
END;
$$;

REVOKE ALL ON FUNCTION public.promote_place_suggestion_to_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_place_suggestion_to_candidate(uuid) TO authenticated;

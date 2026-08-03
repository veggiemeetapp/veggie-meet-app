-- 1. TABLE
CREATE TABLE public.community_place_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  city_id uuid REFERENCES public.cities(id),
  place_name text NOT NULL,
  address_text text NOT NULL,
  official_source_url text NOT NULL,
  vegan_reason text NOT NULL,
  submitter_note text,
  moderation_status text NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending','under_review','approved','rejected','duplicate')),
  rejection_reason text
    CHECK (rejection_reason IS NULL OR rejection_reason IN
      ('not_fully_vegan','insufficient_evidence','closed_or_unavailable','incorrect_information','outside_supported_city','other')),
  moderation_notes text,
  duplicate_of_place_id uuid REFERENCES public.community_places(id) ON DELETE SET NULL,
  duplicate_of_candidate_id uuid REFERENCES public.place_candidates(id) ON DELETE SET NULL,
  duplicate_of_suggestion_id uuid REFERENCES public.community_place_suggestions(id) ON DELETE SET NULL,
  promoted_candidate_id uuid REFERENCES public.place_candidates(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. GRANTS (no anon; users read only their own rows via RLS, all writes via RPC)
GRANT SELECT ON public.community_place_suggestions TO authenticated;
GRANT ALL ON public.community_place_suggestions TO service_role;

-- 3. RLS
ALTER TABLE public.community_place_suggestions ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES
CREATE POLICY "Users read own suggestions"
  ON public.community_place_suggestions FOR SELECT TO authenticated
  USING (submitted_by = public.current_profile_id());

CREATE POLICY "Owner reads all suggestions"
  ON public.community_place_suggestions FOR SELECT TO authenticated
  USING (public.is_owner());

-- INDEXES
CREATE INDEX idx_cps_status ON public.community_place_suggestions (moderation_status);
CREATE INDEX idx_cps_city ON public.community_place_suggestions (city_id);
CREATE INDEX idx_cps_submitter ON public.community_place_suggestions (submitted_by);
CREATE INDEX idx_cps_submitted_at ON public.community_place_suggestions (submitted_at DESC);

CREATE TRIGGER trg_cps_updated_at
  BEFORE UPDATE ON public.community_place_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- helper: normalized text for duplicate matching
CREATE OR REPLACE FUNCTION public._suggestion_norm(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT regexp_replace(lower(coalesce(_t,'')), '[^a-z0-9]+', '', 'g');
$$;
REVOKE ALL ON FUNCTION public._suggestion_norm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._suggestion_norm(text) TO service_role;

-- 5. SUBMISSION RPC
CREATE OR REPLACE FUNCTION public.submit_community_place_suggestion(
  _city_id uuid,
  _place_name text,
  _address_text text,
  _official_source_url text,
  _vegan_reason text,
  _submitter_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  me uuid;
  nm text; ad text; url text; rsn text; note text;
  host text;
  recent int;
  dup boolean;
  new_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  nm   := btrim(regexp_replace(coalesce(_place_name,''), '\s+', ' ', 'g'));
  ad   := btrim(regexp_replace(coalesce(_address_text,''), '\s+', ' ', 'g'));
  url  := btrim(coalesce(_official_source_url,''));
  rsn  := btrim(coalesce(_vegan_reason,''));
  note := nullif(btrim(coalesce(_submitter_note,'')), '');

  IF nm = '' OR length(nm) > 120
     OR ad = '' OR length(ad) > 240
     OR rsn = '' OR length(rsn) > 600
     OR (note IS NOT NULL AND length(note) > 600)
     OR _city_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  IF url = '' OR length(url) > 500 OR url !~* '^https?://[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?\.[a-z]{2,}(:[0-9]+)?(/|\?|#|$)' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_url');
  END IF;

  -- Only cities that already have a published Community Place are supported.
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

  host := lower(split_part(regexp_replace(url, '^https?://', ''), '/', 1));
  host := regexp_replace(host, '^www\.', '');

  SELECT EXISTS (
    SELECT 1 FROM public.community_places p
     WHERE public._suggestion_norm(p.name) = public._suggestion_norm(nm)
        OR (p.website_url IS NOT NULL AND host <> '' AND position(host in lower(p.website_url)) > 0)
    UNION ALL
    SELECT 1 FROM public.place_candidates c
     WHERE public._suggestion_norm(c.display_name) = public._suggestion_norm(nm)
        OR (c.google_website_url IS NOT NULL AND host <> '' AND position(host in lower(c.google_website_url)) > 0)
    UNION ALL
    SELECT 1 FROM public.community_place_suggestions s
     WHERE s.moderation_status IN ('pending','under_review')
       AND (public._suggestion_norm(s.place_name) = public._suggestion_norm(nm)
            OR public._suggestion_norm(s.official_source_url) = public._suggestion_norm(url))
  ) INTO dup;

  IF dup THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_suggestion');
  END IF;

  INSERT INTO public.community_place_suggestions (
    submitted_by, city_id, place_name, address_text,
    official_source_url, vegan_reason, submitter_note, moderation_status
  ) VALUES (me, _city_id, nm, ad, url, rsn, note, 'pending')
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'success', 'suggestion_id', new_id);
END; $$;
REVOKE ALL ON FUNCTION public.submit_community_place_suggestion(uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_community_place_suggestion(uuid,text,text,text,text,text) TO authenticated;

-- 6. USER HISTORY RPC (privacy-safe projection)
CREATE OR REPLACE FUNCTION public.get_my_place_suggestions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE me uuid; out jsonb;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'place_name', s.place_name,
    'city_name', c.name,
    'submitted_at', s.submitted_at,
    'status', s.moderation_status
  ) ORDER BY s.submitted_at DESC), '[]'::jsonb)
    INTO out
    FROM public.community_place_suggestions s
    LEFT JOIN public.cities c ON c.id = s.city_id
   WHERE s.submitted_by = me;
  RETURN out;
END; $$;
REVOKE ALL ON FUNCTION public.get_my_place_suggestions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_place_suggestions() TO authenticated;

-- 7. OWNER QUEUE RPC
CREATE OR REPLACE FUNCTION public.get_place_suggestion_queue()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE out jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
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
    'moderation_status', s.moderation_status,
    'rejection_reason', s.rejection_reason,
    'promoted_candidate_id', s.promoted_candidate_id,
    'submitter_profile_id', s.submitted_by,
    'possible_duplicate', EXISTS (
      SELECT 1 FROM public.community_places p
       WHERE public._suggestion_norm(p.name) = public._suggestion_norm(s.place_name))
      OR EXISTS (
      SELECT 1 FROM public.place_candidates pc
       WHERE public._suggestion_norm(pc.display_name) = public._suggestion_norm(s.place_name))
  ) ORDER BY
      CASE s.moderation_status WHEN 'pending' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
      s.submitted_at ASC), '[]'::jsonb)
    INTO out
    FROM public.community_place_suggestions s
    LEFT JOIN public.cities c ON c.id = s.city_id;
  RETURN out;
END; $$;
REVOKE ALL ON FUNCTION public.get_place_suggestion_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_place_suggestion_queue() TO authenticated;

-- 8. OWNER MODERATION RPC (start review / reject / mark duplicate)
CREATE OR REPLACE FUNCTION public.moderate_place_suggestion(
  _suggestion_id uuid,
  _action text,
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE me uuid; s record; next_status text;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  me := public.current_profile_id();

  SELECT * INTO s FROM public.community_place_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF s.moderation_status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_promoted');
  END IF;

  IF _action = 'start_review' THEN next_status := 'under_review';
  ELSIF _action = 'reject' THEN
    IF _reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_required'); END IF;
    next_status := 'rejected';
  ELSIF _action = 'duplicate' THEN next_status := 'duplicate';
  ELSE RETURN jsonb_build_object('ok', false, 'reason', 'invalid_action');
  END IF;

  UPDATE public.community_place_suggestions
     SET moderation_status = next_status,
         rejection_reason = CASE WHEN next_status = 'rejected' THEN _reason ELSE rejection_reason END,
         moderation_notes = coalesce(_notes, moderation_notes),
         reviewed_at = now(),
         reviewed_by = me
   WHERE id = _suggestion_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'success', 'status', next_status);
END; $$;
REVOKE ALL ON FUNCTION public.moderate_place_suggestion(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_place_suggestion(uuid,text,text,text) TO authenticated;

-- 9. OWNER PROMOTE RPC — creates ONE private candidate, never publishes
CREATE OR REPLACE FUNCTION public.promote_place_suggestion_to_candidate(_suggestion_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE me uuid; s record; cand_id uuid;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  me := public.current_profile_id();

  SELECT * INTO s FROM public.community_place_suggestions WHERE id = _suggestion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF s.promoted_candidate_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_promoted');
  END IF;
  IF s.moderation_status NOT IN ('pending','under_review') THEN
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
      || E'\nOfficial source: ' || s.official_source_url,
    'none', me
  ) RETURNING id INTO cand_id;

  UPDATE public.community_place_suggestions
     SET moderation_status = 'approved',
         promoted_candidate_id = cand_id,
         reviewed_at = now(),
         reviewed_by = me
   WHERE id = _suggestion_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'success', 'candidate_id', cand_id);
END; $$;
REVOKE ALL ON FUNCTION public.promote_place_suggestion_to_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_place_suggestion_to_candidate(uuid) TO authenticated;
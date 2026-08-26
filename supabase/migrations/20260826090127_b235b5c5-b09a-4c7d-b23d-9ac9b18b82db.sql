-- WO-132 DEF-132-01
-- Root cause: publish set verified_by = auth.uid() unconditionally; the owner
-- account has no profiles row, so the FK community_places_verified_by_fkey
-- (23503) aborted publication and surfaced as a generic failure.
-- Fix: resolve the actor to a profile-backed id (NULL when absent), and raise
-- machine-readable taxonomy codes for every publication rule.

CREATE OR REPLACE FUNCTION public.publish_place_candidate(_candidate_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.place_candidates;
  new_id uuid;
  me uuid;
  pub_name text;
  pub_address text;
  verified_ts timestamptz := now();
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'PLACE_PERMISSION_DENIED' USING errcode = '42501';
  END IF;
  -- Only a profile-backed actor satisfies community_places.verified_by FK.
  SELECT p.id INTO me FROM public.profiles p WHERE p.id = auth.uid();

  SELECT * INTO c FROM public.place_candidates WHERE id = _candidate_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'PLACE_NOT_FOUND'; END IF;

  IF c.verification_status = 'published' AND c.published_place_id IS NOT NULL THEN
    RETURN c.published_place_id;
  END IF;
  IF c.verification_status = 'rejected' THEN
    RAISE EXCEPTION 'PLACE_REJECTED';
  END IF;
  IF c.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'PLACE_INVALID_STATE';
  END IF;
  IF c.google_place_id IS NULL THEN RAISE EXCEPTION 'PLACE_GOOGLE_ID_MISSING'; END IF;

  pub_name := btrim(coalesce(nullif(btrim(c.public_display_name), ''), c.display_name));
  pub_address := btrim(coalesce(nullif(btrim(c.public_address), ''), c.google_formatted_address, ''));
  IF pub_address = '' THEN RAISE EXCEPTION 'PLACE_ADDRESS_MISSING'; END IF;
  IF c.latitude IS NULL OR c.longitude IS NULL THEN RAISE EXCEPTION 'PLACE_COORDINATES_MISSING'; END IF;
  IF coalesce(c.business_status, '') <> 'OPERATIONAL' THEN RAISE EXCEPTION 'PLACE_BUSINESS_STATUS_INVALID'; END IF;
  IF c.category IS NULL THEN RAISE EXCEPTION 'PLACE_CATEGORY_MISSING'; END IF;
  IF coalesce(btrim(c.description), '') = '' THEN RAISE EXCEPTION 'PLACE_DESCRIPTION_MISSING'; END IF;
  IF coalesce(btrim(c.veggie_reason), '') = '' THEN RAISE EXCEPTION 'PLACE_VEGGIE_REASON_MISSING'; END IF;
  IF c.veggie_classification IS NULL THEN RAISE EXCEPTION 'PLACE_VEGGIE_CLASSIFICATION_MISSING'; END IF;
  IF c.image_rights_status NOT IN ('none','owner_supplied','restaurant_supplied','licensed')
     OR (c.cover_image_url IS NOT NULL AND c.image_rights_status = 'none') THEN
    RAISE EXCEPTION 'PLACE_IMAGE_RIGHTS_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.community_places p WHERE p.google_place_id = c.google_place_id) THEN
    RAISE EXCEPTION 'PLACE_DUPLICATE_GOOGLE_ID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_places p
    WHERE p.is_active
      AND lower(btrim(p.name)) = lower(pub_name)
      AND lower(btrim(p.address)) = lower(pub_address)
  ) THEN
    RAISE EXCEPTION 'PLACE_DUPLICATE_NAME_ADDRESS';
  END IF;

  INSERT INTO public.community_places (
    name, category, address, cover_image_url, city_id, neighborhood,
    latitude, longitude, is_active,
    google_place_id, google_maps_url, verification_status, verified_at, verified_by,
    last_reverified_at,
    source, business_status, image_rights_status,
    description, veggie_reason, website_url, veggie_classification
  ) VALUES (
    pub_name, c.category, pub_address, c.cover_image_url,
    c.city_id, c.district, c.latitude, c.longitude, true,
    c.google_place_id, c.google_maps_url, 'verified', verified_ts, me,
    verified_ts,
    c.source, c.business_status, c.image_rights_status,
    btrim(c.description), btrim(c.veggie_reason), c.google_website_url, c.veggie_classification
  ) RETURNING id INTO new_id;

  UPDATE public.place_candidates
     SET verification_status = 'published',
         published_place_id = new_id,
         published_at = verified_ts
   WHERE id = c.id;

  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_and_publish_place_candidate(_candidate_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.place_candidates;
  new_id uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'PLACE_PERMISSION_DENIED' USING errcode = '42501';
  END IF;

  SELECT * INTO c FROM public.place_candidates WHERE id = _candidate_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'PLACE_NOT_FOUND'; END IF;

  IF c.verification_status = 'published' AND c.published_place_id IS NOT NULL THEN
    RETURN c.published_place_id;
  END IF;
  IF c.verification_status = 'rejected' THEN
    RAISE EXCEPTION 'PLACE_REJECTED';
  END IF;

  UPDATE public.place_candidates
     SET verification_status = 'verified'
   WHERE id = c.id;

  -- Same transaction: publish revalidates every rule and flips to published.
  new_id := public.publish_place_candidate(c.id);
  RETURN new_id;
END; $function$;

REVOKE ALL ON FUNCTION public.publish_place_candidate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_and_publish_place_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_place_candidate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_publish_place_candidate(uuid) TO authenticated;
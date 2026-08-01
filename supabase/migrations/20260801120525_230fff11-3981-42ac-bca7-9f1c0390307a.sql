ALTER TABLE public.community_places
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS veggie_reason text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS veggie_classification text;

ALTER TABLE public.community_places
  ADD CONSTRAINT community_places_veggie_classification_check
  CHECK (veggie_classification IS NULL OR veggie_classification = ANY (ARRAY['fully_vegan','fully_vegetarian','vegetarian_friendly','vegan_options','not_food']));

ALTER TABLE public.place_candidates
  ADD COLUMN IF NOT EXISTS public_display_name text,
  ADD COLUMN IF NOT EXISTS public_address text;

CREATE OR REPLACE FUNCTION public.publish_place_candidate(_candidate_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.place_candidates;
  me uuid;
  new_id uuid;
  pub_name text;
  pub_address text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := public.current_profile_id();

  SELECT * INTO c FROM public.place_candidates WHERE id = _candidate_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  IF c.verification_status = 'published' THEN RAISE EXCEPTION 'Candidate already published.'; END IF;
  IF c.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'Candidate must be marked verified before publishing.';
  END IF;

  IF c.google_place_id IS NULL AND c.source = 'google_discovered' THEN
    RAISE EXCEPTION 'Google Place ID is required for Google-discovered businesses.';
  END IF;
  IF c.google_place_id IS NULL AND c.veggie_classification <> 'not_food' AND c.source <> 'owner_curated' THEN
    RAISE EXCEPTION 'Google Place ID is required for business locations.';
  END IF;

  pub_name := btrim(coalesce(nullif(btrim(c.public_display_name), ''), c.display_name));
  pub_address := btrim(coalesce(nullif(btrim(c.public_address), ''), c.google_formatted_address, ''));

  IF pub_address = '' THEN
    RAISE EXCEPTION 'Exact address is required.';
  END IF;
  IF c.latitude IS NULL OR c.longitude IS NULL THEN
    RAISE EXCEPTION 'Exact coordinates are required.';
  END IF;
  IF c.business_status = 'CLOSED_PERMANENTLY' THEN
    RAISE EXCEPTION 'Cannot publish a permanently closed place.';
  END IF;
  IF coalesce(btrim(c.description), '') = '' THEN
    RAISE EXCEPTION 'An original VeggieMeet description is required.';
  END IF;
  IF coalesce(btrim(c.veggie_reason), '') = '' THEN
    RAISE EXCEPTION 'A veggie-friendly reason is required.';
  END IF;
  IF c.category IS NULL THEN
    RAISE EXCEPTION 'A category is required.';
  END IF;
  IF c.cover_image_url IS NOT NULL AND c.image_rights_status = 'none' THEN
    RAISE EXCEPTION 'Image rights must be explicitly classified before publishing.';
  END IF;

  IF c.google_place_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.community_places p WHERE p.google_place_id = c.google_place_id
  ) THEN
    RAISE EXCEPTION 'A published place already uses this Google Place ID.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_places p
    WHERE p.is_active
      AND lower(btrim(p.name)) = lower(pub_name)
      AND lower(btrim(p.address)) = lower(pub_address)
  ) THEN
    RAISE EXCEPTION 'A published place already uses this name and address.';
  END IF;

  INSERT INTO public.community_places (
    name, category, address, cover_image_url, city_id, neighborhood,
    latitude, longitude, is_active,
    google_place_id, google_maps_url, verification_status, verified_at, verified_by,
    source, business_status, image_rights_status,
    description, veggie_reason, website_url, veggie_classification
  ) VALUES (
    pub_name, c.category, pub_address, c.cover_image_url,
    c.city_id, c.district, c.latitude, c.longitude, true,
    c.google_place_id, c.google_maps_url, 'verified', now(), me,
    c.source, c.business_status, c.image_rights_status,
    btrim(c.description), btrim(c.veggie_reason), c.google_website_url, c.veggie_classification
  ) RETURNING id INTO new_id;

  UPDATE public.place_candidates
     SET verification_status = 'published',
         published_place_id = new_id,
         published_at = now()
   WHERE id = c.id;

  RETURN new_id;
END; $function$;
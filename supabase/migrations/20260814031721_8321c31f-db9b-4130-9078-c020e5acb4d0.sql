CREATE OR REPLACE FUNCTION public.verify_and_publish_place_candidate(_candidate_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.place_candidates;
  new_id uuid;
  pub_name text;
  pub_address text;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;

  -- Lock the candidate so a double submission cannot publish twice.
  SELECT * INTO c FROM public.place_candidates WHERE id = _candidate_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Candidate not found.'; END IF;

  -- Idempotency: an already-published candidate returns its existing place.
  IF c.verification_status = 'published' AND c.published_place_id IS NOT NULL THEN
    RETURN c.published_place_id;
  END IF;
  IF c.verification_status = 'rejected' THEN
    RAISE EXCEPTION 'This candidate was rejected and cannot be published.';
  END IF;

  -- Verification gate (mirrors and precedes the publish gate).
  IF c.google_place_id IS NULL THEN
    RAISE EXCEPTION 'Candidate is missing required verification details.';
  END IF;
  pub_name := btrim(coalesce(nullif(btrim(c.public_display_name), ''), c.display_name));
  pub_address := btrim(coalesce(nullif(btrim(c.public_address), ''), c.google_formatted_address, ''));
  IF pub_address = '' OR c.latitude IS NULL OR c.longitude IS NULL THEN
    RAISE EXCEPTION 'Candidate is missing required verification details.';
  END IF;
  IF coalesce(c.business_status, '') <> 'OPERATIONAL' THEN
    RAISE EXCEPTION 'Google reports this business is not operational.';
  END IF;
  IF c.category IS NULL
     OR coalesce(btrim(c.description), '') = ''
     OR coalesce(btrim(c.veggie_reason), '') = '' THEN
    RAISE EXCEPTION 'Candidate is missing required verification details.';
  END IF;
  IF c.cover_image_url IS NOT NULL AND c.image_rights_status = 'none' THEN
    RAISE EXCEPTION 'Image rights must be explicitly classified before publishing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_places p WHERE p.google_place_id = c.google_place_id
  ) THEN
    RAISE EXCEPTION 'This Google Place is already represented in Community Places.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_places p
    WHERE p.is_active
      AND lower(btrim(p.name)) = lower(pub_name)
      AND lower(btrim(p.address)) = lower(pub_address)
  ) THEN
    RAISE EXCEPTION 'A published place already uses this name and address.';
  END IF;

  UPDATE public.place_candidates
     SET verification_status = 'verified'
   WHERE id = c.id;

  -- Same transaction: publish revalidates everything and flips to published.
  new_id := public.publish_place_candidate(c.id);
  RETURN new_id;
END; $function$;

REVOKE ALL ON FUNCTION public.verify_and_publish_place_candidate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_and_publish_place_candidate(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_and_publish_place_candidate(uuid) TO authenticated;
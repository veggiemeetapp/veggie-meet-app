-- WO-111 / DEF-111-01
-- 1) Freshness: a candidate verification + publish IS the initial verification.
--    Age is measured from the latest legitimate verification (last_reverified_at,
--    falling back to verified_at). Never having been through a *reverification
--    review* is no longer treated as overdue.
CREATE OR REPLACE FUNCTION public.place_freshness_label(
  _verified_at timestamptz,
  _last_reverified_at timestamptz
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    -- No verification at all: genuinely stale, must be verified.
    WHEN COALESCE(_last_reverified_at, _verified_at) IS NULL THEN 'due'
    WHEN now() - COALESCE(_last_reverified_at, _verified_at) > INTERVAL '180 days' THEN 'due'
    WHEN now() - COALESCE(_last_reverified_at, _verified_at) >= INTERVAL '150 days' THEN 'due_soon'
    ELSE 'current'
  END
$$;

-- 2) Publish transaction seeds the initial verification record.
--    verified_at  = first verification (immutable afterwards)
--    last_reverified_at = latest verification (starts the reverification clock)
CREATE OR REPLACE FUNCTION public.publish_place_candidate(_candidate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c public.place_candidates;
  new_id uuid;
  me uuid;
  pub_name text;
  pub_address text;
  verified_ts timestamptz := now();
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  me := auth.uid();

  SELECT * INTO c FROM public.place_candidates WHERE id = _candidate_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Candidate not found.'; END IF;

  -- Idempotency: already published returns the existing place untouched.
  IF c.verification_status = 'published' AND c.published_place_id IS NOT NULL THEN
    RETURN c.published_place_id;
  END IF;
  IF c.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'Only a verified candidate can be published.';
  END IF;
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
$fn$;

REVOKE ALL ON FUNCTION public.publish_place_candidate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_place_candidate(uuid) TO authenticated;

-- 3) Bounded repair: only places published from a verified candidate whose
--    latest-verification date was never seeded by the buggy publish path.
--    Uses the real publication/verification timestamp - nothing is invented,
--    and no completed reverification history is touched or created.
UPDATE public.community_places p
   SET last_reverified_at = p.verified_at,
       updated_at = now()
 WHERE p.last_reverified_at IS NULL
   AND p.verified_at IS NOT NULL
   AND p.verification_status = 'verified'
   AND EXISTS (
     SELECT 1 FROM public.place_candidates c
      WHERE c.published_place_id = p.id
        AND c.verification_status = 'published'
        AND c.google_place_id IS NOT NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.community_place_reverifications r
      WHERE r.community_place_id = p.id AND r.status = 'completed'
   );
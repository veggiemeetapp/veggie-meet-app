-- ============================================================
-- WO-043B: Community Places Google verification foundation
-- ============================================================

-- ---------- 1. community_places verification columns ----------
ALTER TABLE public.community_places
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS google_maps_url text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'owner_curated',
  ADD COLUMN IF NOT EXISTS business_status text,
  ADD COLUMN IF NOT EXISTS image_rights_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.community_places
  DROP CONSTRAINT IF EXISTS community_places_verification_status_check,
  DROP CONSTRAINT IF EXISTS community_places_public_verified_only,
  DROP CONSTRAINT IF EXISTS community_places_source_check,
  DROP CONSTRAINT IF EXISTS community_places_business_status_check,
  DROP CONSTRAINT IF EXISTS community_places_image_rights_status_check;

ALTER TABLE public.community_places
  ADD CONSTRAINT community_places_verification_status_check
    CHECK (verification_status IN ('draft','verified','rejected','needs_review')),
  -- Public-table invariant: drafts / rejected / needs_review live ONLY in
  -- public.place_candidates. community_places is a verified-only surface.
  ADD CONSTRAINT community_places_public_verified_only
    CHECK (verification_status = 'verified'),
  ADD CONSTRAINT community_places_source_check
    CHECK (source IN ('owner_curated','community_submitted','google_discovered')),
  ADD CONSTRAINT community_places_business_status_check
    CHECK (business_status IS NULL OR business_status IN ('OPERATIONAL','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY')),
  ADD CONSTRAINT community_places_image_rights_status_check
    CHECK (image_rights_status IN ('none','owner_supplied','restaurant_supplied','licensed'));

-- Dedupe: one row per Google Place ID.
CREATE UNIQUE INDEX IF NOT EXISTS community_places_google_place_id_key
  ON public.community_places (google_place_id)
  WHERE google_place_id IS NOT NULL;

-- Dedupe: one active row per name + address (case/space-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS community_places_name_address_key
  ON public.community_places (lower(btrim(name)), lower(btrim(address)))
  WHERE is_active;

-- Verified-only public read surface.
DROP POLICY IF EXISTS "Signed-in users can view places" ON public.community_places;
CREATE POLICY "Signed-in users can view verified places"
  ON public.community_places FOR SELECT TO authenticated
  USING (verification_status = 'verified' AND is_active);

-- ---------- 2. owner allowlist (temporary, pre-admin-role) ----------
CREATE TABLE IF NOT EXISTS public.owner_allowlist (
  auth_user_id uuid PRIMARY KEY,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Deliberately NO grants to anon/authenticated: readable only by
-- service_role and by SECURITY DEFINER helpers below.
GRANT ALL ON public.owner_allowlist TO service_role;
ALTER TABLE public.owner_allowlist ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.owner_allowlist o WHERE o.auth_user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

-- ---------- 3. owner-only candidate table ----------
CREATE TABLE IF NOT EXISTS public.place_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Google-imported verification fields (allowed set only)
  google_place_id text,
  google_display_name text,
  google_formatted_address text,
  google_primary_type text,
  google_maps_url text,
  google_website_url text,
  business_status text,
  latitude double precision,
  longitude double precision,
  -- VeggieMeet-authored curation
  display_name text NOT NULL,
  category public.place_category,
  veggie_classification text,
  veggie_reason text,
  description text,
  district text,
  group_suitability text,
  cover_image_url text,
  image_source text,
  image_rights_status text NOT NULL DEFAULT 'none',
  verification_notes text,
  -- Workflow
  city_id uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'owner_curated',
  verification_status text NOT NULL DEFAULT 'draft',
  review_order integer,
  published_place_id uuid REFERENCES public.community_places(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_candidates_verification_status_check
    CHECK (verification_status IN ('draft','verified','rejected','needs_review','published')),
  CONSTRAINT place_candidates_source_check
    CHECK (source IN ('owner_curated','community_submitted','google_discovered')),
  CONSTRAINT place_candidates_image_rights_status_check
    CHECK (image_rights_status IN ('none','owner_supplied','restaurant_supplied','licensed')),
  CONSTRAINT place_candidates_business_status_check
    CHECK (business_status IS NULL OR business_status IN ('OPERATIONAL','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY')),
  CONSTRAINT place_candidates_veggie_classification_check
    CHECK (veggie_classification IS NULL OR veggie_classification IN ('fully_vegan','fully_vegetarian','vegetarian_friendly','vegan_options','not_food'))
);

CREATE UNIQUE INDEX IF NOT EXISTS place_candidates_google_place_id_key
  ON public.place_candidates (google_place_id)
  WHERE google_place_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.place_candidates TO authenticated;
GRANT ALL ON public.place_candidates TO service_role;
ALTER TABLE public.place_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage place candidates" ON public.place_candidates;
CREATE POLICY "Owners manage place candidates"
  ON public.place_candidates FOR ALL TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

DROP TRIGGER IF EXISTS set_place_candidates_updated_at ON public.place_candidates;
CREATE TRIGGER set_place_candidates_updated_at
  BEFORE UPDATE ON public.place_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 4. owner-only publish / reject RPCs ----------
CREATE OR REPLACE FUNCTION public.reject_place_candidate(_candidate_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'permission denied' USING errcode = '42501';
  END IF;
  UPDATE public.place_candidates
     SET verification_status = 'rejected',
         verification_notes = COALESCE(_notes, verification_notes)
   WHERE id = _candidate_id AND verification_status <> 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate not found or already published.';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.reject_place_candidate(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_place_candidate(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_place_candidate(_candidate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.place_candidates;
  me uuid;
  new_id uuid;
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

  -- Google Place ID required for businesses; owner-curated non-business
  -- locations (parks, public spaces) may publish without one.
  IF c.google_place_id IS NULL AND c.source = 'google_discovered' THEN
    RAISE EXCEPTION 'Google Place ID is required for Google-discovered businesses.';
  END IF;
  IF c.google_place_id IS NULL AND c.veggie_classification <> 'not_food' AND c.source <> 'owner_curated' THEN
    RAISE EXCEPTION 'Google Place ID is required for business locations.';
  END IF;

  IF coalesce(btrim(c.google_formatted_address), '') = '' THEN
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
      AND lower(btrim(p.name)) = lower(btrim(c.display_name))
      AND lower(btrim(p.address)) = lower(btrim(c.google_formatted_address))
  ) THEN
    RAISE EXCEPTION 'A published place already uses this name and address.';
  END IF;

  INSERT INTO public.community_places (
    name, category, address, cover_image_url, city_id, neighborhood,
    latitude, longitude, is_active,
    google_place_id, google_maps_url, verification_status, verified_at, verified_by,
    source, business_status, image_rights_status
  ) VALUES (
    btrim(c.display_name), c.category, btrim(c.google_formatted_address), c.cover_image_url,
    c.city_id, c.district, c.latitude, c.longitude, true,
    c.google_place_id, c.google_maps_url, 'verified', now(), me,
    c.source, c.business_status, c.image_rights_status
  ) RETURNING id INTO new_id;

  UPDATE public.place_candidates
     SET verification_status = 'published',
         published_place_id = new_id,
         published_at = now()
   WHERE id = c.id;

  RETURN new_id;
END; $$;
REVOKE ALL ON FUNCTION public.publish_place_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_place_candidate(uuid) TO authenticated;
-- WO-131B: server-side cover format guard for hosted Meetup creation.
-- Defence in depth: the client re-encodes every cover to a JPEG data URL, but
-- the RPC previously accepted ANY text under 500,000 chars as a cover. This
-- pins the accepted shapes to https(:) image URLs and raster image data URLs
-- (jpeg/png/webp) so an SVG/script-bearing or javascript: payload can never be
-- persisted as a cover. No grant, RLS, ownership or validation rule is relaxed.
CREATE OR REPLACE FUNCTION public.is_allowed_meetup_cover(_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT _url IS NULL
      OR btrim(_url) = ''
      OR _url ~ '^https://[^\s<>"'']+$'
      OR _url ~ '^data:image/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$'
$$;

REVOKE ALL ON FUNCTION public.is_allowed_meetup_cover(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_allowed_meetup_cover(text) TO authenticated, service_role;
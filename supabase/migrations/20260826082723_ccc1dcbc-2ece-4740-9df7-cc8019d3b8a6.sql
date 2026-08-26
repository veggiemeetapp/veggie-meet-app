-- WO-131B: enforce the cover allowlist on every write path to meetups, using
-- the same BEFORE-trigger pattern already used for place and interest tag
-- validation. This adds a restriction only; nothing is relaxed.
CREATE OR REPLACE FUNCTION public.validate_meetup_cover()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.cover_image_url IS NOT NULL
     AND char_length(NEW.cover_image_url) > 500000 THEN
    RAISE EXCEPTION 'Cover image is too large';
  END IF;
  IF NOT public.is_allowed_meetup_cover(NEW.cover_image_url) THEN
    RAISE EXCEPTION 'That cover photo format isn''t supported. Use a JPG, PNG, or WebP photo.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_meetup_cover() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_meetup_cover ON public.meetups;
CREATE TRIGGER trg_validate_meetup_cover
  BEFORE INSERT OR UPDATE OF cover_image_url ON public.meetups
  FOR EACH ROW EXECUTE FUNCTION public.validate_meetup_cover();
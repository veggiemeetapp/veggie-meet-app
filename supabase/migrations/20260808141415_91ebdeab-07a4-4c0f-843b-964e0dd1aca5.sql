-- WO-075 DEF-075-01: search_norm previously passed LIKE metacharacters through,
-- so a query of '%' or '_' matched every discovery-eligible profile, meetup and
-- place — an enumeration path that bypassed the intent of "search by name".
-- Normalisation now trims, collapses internal whitespace and escapes LIKE
-- metacharacters. Both sides of every comparison run through search_norm, so
-- equality and prefix scoring stay consistent.
CREATE OR REPLACE FUNCTION public.search_norm(_t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT replace(
           replace(
             replace(
               btrim(regexp_replace(lower(public.unaccent(coalesce(_t, ''))), '\s+', ' ', 'g')),
               '\', '\\'),
             '%', '\%'),
           '_', '\_')
$$;

REVOKE ALL ON FUNCTION public.search_norm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_norm(text) TO authenticated;
-- Explore is a primary member surface. Keep the existing SECURITY DEFINER map
-- RPC and its published-content filters, while allowing every authenticated
-- member to call it. Anonymous visitors remain blocked by both this check and
-- the RPC EXECUTE grant.
CREATE OR REPLACE FUNCTION public.has_map_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.has_map_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_map_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_map_access() TO service_role;

COMMENT ON FUNCTION public.has_map_access() IS
  'Returns true for authenticated members so Explore can load published map data.';

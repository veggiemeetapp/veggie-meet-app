DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'community_places'
     AND column_name NOT IN (
       'google_place_id', 'verified_by', 'source', 'status_note', 'status_changed_by'
     );

  EXECUTE 'REVOKE SELECT ON public.community_places FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.community_places TO authenticated', cols);
END $$;
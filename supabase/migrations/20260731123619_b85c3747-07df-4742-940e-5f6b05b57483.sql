CREATE OR REPLACE FUNCTION public.get_my_today_experience()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid;
  my_city text;
  my_city_id uuid;
  my_interests text[];
  now_ts timestamptz := now();
  today_date date := (now() AT TIME ZONE 'UTC')::date;
  primary_action jsonb := NULL;
  meetup_recs jsonb := '[]'::jsonb;
  veggie_recs jsonb := '[]'::jsonb;
  place_recs jsonb := '[]'::jsonb;
  used_meetup_ids uuid[] := ARRAY[]::uuid[];
  primary_entity_type text := NULL;
  primary_entity_id text := NULL;
  base jsonb;
BEGIN
  base := public.get_my_today_experience_v1();
  RETURN base;
END;
$function$;
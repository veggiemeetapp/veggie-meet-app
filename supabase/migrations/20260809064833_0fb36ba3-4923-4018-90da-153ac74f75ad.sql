CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (auth_user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'display_name',
                                   NEW.raw_user_meta_data->>'full_name',
                                   NEW.raw_user_meta_data->>'name', '')), ''), '')
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END; $function$;

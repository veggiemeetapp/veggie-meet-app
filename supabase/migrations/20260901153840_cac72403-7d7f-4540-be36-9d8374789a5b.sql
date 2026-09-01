CREATE OR REPLACE FUNCTION public.platform_avatar_token(_seed uuid)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  h bigint := 2166136261;  -- 0x811c9dc5 (FNV-1a offset basis)
  s text := _seed::text;
  i int;
BEGIN
  FOR i IN 1..length(s) LOOP
    h := h # ascii(substr(s, i, 1));
    h := (h * 16777619) % 4294967296;  -- 0x01000193, wrap to 32 bits
  END LOOP;
  RETURN 'veggiemeet:avatar-' || lpad(((h % 8) + 1)::text, 2, '0');
END
$function$;

UPDATE public.profiles p
   SET avatar_url = public.platform_avatar_token(p.id)
 WHERE p.avatar_url ~ '^veggiemeet:avatar-[0-9]{2}$'
   AND p.avatar_url <> public.platform_avatar_token(p.id);
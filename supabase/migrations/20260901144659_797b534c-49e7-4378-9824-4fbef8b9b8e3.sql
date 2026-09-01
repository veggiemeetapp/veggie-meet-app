-- WO-143: platform avatar tokens ------------------------------------------

-- Deterministic, stable platform avatar token for a profile id.
CREATE OR REPLACE FUNCTION public.platform_avatar_token(_seed uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT 'veggiemeet:avatar-' || lpad(((abs(hashtext(_seed::text)) % 8) + 1)::text, 2, '0');
$$;

REVOKE ALL ON FUNCTION public.platform_avatar_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_avatar_token(uuid) TO authenticated, service_role;

-- Accept platform avatar tokens alongside hosted https URLs.
CREATE OR REPLACE FUNCTION public.is_safe_avatar_url(_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT _url IS NULL
     OR _url ~ '^veggiemeet:avatar-[0-9]{2}$'
     OR (
       _url ~* '^https://[a-z0-9._~%-]+(:[0-9]+)?/[^[:space:]]*$'
       AND length(_url) <= 2048
     );
$$;

-- New profiles are created with a platform avatar already assigned.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.profiles (id, auth_user_id, display_name, avatar_url)
  VALUES (
    v_pid,
    NEW.id,
    COALESCE(NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'display_name',
                                   NEW.raw_user_meta_data->>'full_name',
                                   NEW.raw_user_meta_data->>'name', '')), ''), ''),
    public.platform_avatar_token(v_pid)
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END; $function$;

-- Clearing a personal photo falls back to the platform avatar, never to NULL.
CREATE OR REPLACE FUNCTION public.update_my_profile(_display_name text DEFAULT NULL::text, _pronouns text DEFAULT NULL::text, _bio text DEFAULT NULL::text, _avatar_url text DEFAULT NULL::text, _clear_avatar boolean DEFAULT false, _interests text[] DEFAULT NULL::text[], _dietary_identity text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pid       uuid := public.current_profile_id();
  v_name      text;
  v_bio       text;
  v_interests text[];
BEGIN
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _display_name IS NOT NULL THEN
    v_name := btrim(_display_name);
    IF length(v_name) = 0 THEN
      RAISE EXCEPTION 'display_name required' USING ERRCODE = '22023';
    END IF;
    IF length(v_name) > 40 THEN
      RAISE EXCEPTION 'display_name too long (max 40)' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _bio IS NOT NULL THEN
    v_bio := btrim(regexp_replace(_bio, '[[:space:]]{4,}', '   ', 'g'));
    IF length(v_bio) > 300 THEN
      RAISE EXCEPTION 'bio too long (max 300)' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _avatar_url IS NOT NULL AND NOT public.is_safe_avatar_url(_avatar_url) THEN
    RAISE EXCEPTION 'avatar must be a hosted https image URL' USING ERRCODE = '22023';
  END IF;

  IF _interests IS NOT NULL THEN
    v_interests := public.normalize_interests(_interests);
  END IF;

  UPDATE public.profiles
     SET display_name      = COALESCE(v_name, display_name),
         pronouns          = CASE WHEN _pronouns IS NOT NULL
                                  THEN NULLIF(btrim(_pronouns), '') ELSE pronouns END,
         bio               = COALESCE(v_bio, bio),
         -- WO-143: no member-facing path can leave a profile without an avatar.
         avatar_url        = CASE
                               WHEN _clear_avatar THEN public.platform_avatar_token(v_pid)
                               ELSE COALESCE(NULLIF(btrim(_avatar_url), ''),
                                             NULLIF(btrim(COALESCE(avatar_url, '')), ''),
                                             public.platform_avatar_token(v_pid))
                             END,
         interests         = COALESCE(v_interests, interests),
         dietary_identity  = COALESCE(_dietary_identity, dietary_identity),
         updated_at        = now()
   WHERE id = v_pid;
END $function$;

-- Repair existing profiles: no avatar, blank avatar, or third-party generated
-- placeholder avatars all become a stable VeggieMeet platform avatar.
UPDATE public.profiles
   SET avatar_url = public.platform_avatar_token(id),
       updated_at = now()
 WHERE COALESCE(btrim(avatar_url), '') = ''
    OR avatar_url ILIKE '%dicebear%'
    OR NOT public.is_safe_avatar_url(avatar_url);

-- Defence in depth: the column can never go back to empty/NULL.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_avatar_present_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_present_chk
  CHECK (avatar_url IS NOT NULL AND btrim(avatar_url) <> '') NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_avatar_present_chk;
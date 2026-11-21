-- 2026-11-21 — Collection: place stickers, meetup memory cards, profile level, badges.
--
-- Additive only. No existing table, policy, trigger or RPC is modified.
--
--  * Stickers are DERIVED from verified place support (_legit_place_supports):
--    one sticker per Community Place, level from visit count. Nothing new is
--    written when a member checks in; the existing check-in RPC is untouched.
--  * Memory cards are the only new state: one photo per member per Meetup
--    they attended or hosted, stored as JPEG data URLs exactly like Meetup
--    covers (no storage bucket, no signed URLs).
--  * Level and badges are computed on read from counts, never stored.
--
-- Privacy: no coordinates, accuracy or distance ever leave the server. The
-- public collection honours blocks and soft-deleted/unfinished profiles.

-- ---------------------------------------------------------------------------
-- 1. Memory cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meetup_memory_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meetup_id uuid NOT NULL REFERENCES public.meetups(id) ON DELETE CASCADE,
  photo_data_url text NOT NULL,
  thumb_data_url text NOT NULL,
  caption text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meetup_memory_cards_unique UNIQUE (profile_id, meetup_id),
  CONSTRAINT meetup_memory_cards_caption_len CHECK (char_length(caption) <= 80),
  CONSTRAINT meetup_memory_cards_photo_len CHECK (char_length(photo_data_url) BETWEEN 1 AND 500000),
  CONSTRAINT meetup_memory_cards_thumb_len CHECK (char_length(thumb_data_url) BETWEEN 1 AND 80000),
  CONSTRAINT meetup_memory_cards_photo_fmt CHECK (photo_data_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'),
  CONSTRAINT meetup_memory_cards_thumb_fmt CHECK (thumb_data_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')
);

CREATE INDEX IF NOT EXISTS mmc_profile_created_idx ON public.meetup_memory_cards (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mmc_meetup_idx ON public.meetup_memory_cards (meetup_id);

ALTER TABLE public.meetup_memory_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meetup_memory_cards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meetup_memory_cards TO service_role;

DROP TRIGGER IF EXISTS meetup_memory_cards_updated_at ON public.meetup_memory_cards;
CREATE TRIGGER meetup_memory_cards_updated_at
  BEFORE UPDATE ON public.meetup_memory_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (not callable by members)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sticker_level(_visits int)
RETURNS int
LANGUAGE sql IMMUTABLE
SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(_visits, 0) >= 10 THEN 3
    WHEN COALESCE(_visits, 0) >= 3 THEN 2
    WHEN COALESCE(_visits, 0) >= 1 THEN 1
    ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public._sticker_level(int) FROM PUBLIC, anon, authenticated;

-- Everything a collection screen needs for one profile. `_include_private`
-- adds the member's hidden cards and the "not collected yet" suggestions;
-- it is only ever true for the member's own view.
CREATE OR REPLACE FUNCTION public._collection_payload(_profile uuid, _include_private boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  stickers jsonb;
  uncollected jsonb := '[]'::jsonb;
  cards jsonb;
  stats jsonb;
  home_city uuid;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.last_visit_at DESC NULLS LAST, s.name), '[]'::jsonb)
    INTO stickers
    FROM (
      SELECT p.id            AS place_id,
             p.name,
             p.category::text AS category,
             p.neighborhood,
             c.name          AS city_name,
             c.country_code,
             p.is_active,
             ls.visits,
             public._sticker_level(ls.visits) AS level,
             ls.first_supported_at AS first_visit_at,
             ls.last_supported_at  AS last_visit_at
        FROM public._legit_place_supports(_profile) ls
        JOIN public.community_places p ON p.id = ls.community_place_id
        LEFT JOIN public.cities c ON c.id = p.city_id
    ) s;

  IF _include_private THEN
    SELECT home_city_id INTO home_city FROM public.profiles WHERE id = _profile;
    IF home_city IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(row_to_json(u)::jsonb), '[]'::jsonb)
        INTO uncollected
        FROM (
          SELECT p.id AS place_id,
                 p.name,
                 p.category::text AS category,
                 p.neighborhood,
                 c.name AS city_name
            FROM public.community_places p
            LEFT JOIN public.cities c ON c.id = p.city_id
           WHERE p.city_id = home_city
             AND p.is_active IS TRUE
             AND p.verification_status = 'verified'
             AND COALESCE(p.maintenance_status, 'operational') = 'operational'
             AND (p.business_status IS NULL OR p.business_status = 'OPERATIONAL')
             AND NOT EXISTS (
               SELECT 1 FROM public._legit_place_supports(_profile) ls
                WHERE ls.community_place_id = p.id
             )
           ORDER BY p.veggies_visited_count DESC, p.name
           LIMIT 30
        ) u;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(k)::jsonb ORDER BY k.date DESC, k.created_at DESC), '[]'::jsonb)
    INTO cards
    FROM (
      SELECT mc.id,
             mc.meetup_id,
             m.title,
             m.date,
             COALESCE(m.city_name_snapshot, ci.name) AS city_name,
             COALESCE(p.name, m.custom_location_name, m.location_name) AS place_name,
             mc.thumb_data_url,
             mc.caption,
             mc.is_public,
             mc.created_at
        FROM public.meetup_memory_cards mc
        JOIN public.meetups m ON m.id = mc.meetup_id
        LEFT JOIN public.community_places p ON p.id = m.community_place_id
        LEFT JOIN public.cities ci ON ci.id = m.city_id
       WHERE mc.profile_id = _profile
         AND (_include_private OR mc.is_public)
    ) k;

  SELECT jsonb_build_object(
    'meetups_attended', (
      SELECT count(*)::int
        FROM public.attendance a
        JOIN public.meetups m ON m.id = a.meetup_id
       WHERE a.profile_id = _profile
         AND a.status::text IN ('checked_in','attended')
         AND m.host_id <> _profile
         AND m.status <> 'cancelled'::meetup_status
         AND (m.date + COALESCE(m.end_time, m.start_time + INTERVAL '2 hours')) <= now()
    ),
    'meetups_hosted', (SELECT count(*)::int FROM public._legit_hosted_meetup_ids(_profile)),
    'verified_connections', (SELECT count(*)::int FROM public._legit_verified_pairs(_profile)),
    'memory_cards', (SELECT count(*)::int FROM public.meetup_memory_cards WHERE profile_id = _profile),
    'member_since', (SELECT created_at FROM public.profiles WHERE id = _profile)
  ) INTO stats;

  RETURN jsonb_build_object(
    'stickers', stickers,
    'uncollected', uncollected,
    'cards', cards,
    'stats', stats
  );
END; $$;
REVOKE ALL ON FUNCTION public._collection_payload(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Member RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_collection()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN public._collection_payload(me, true) || jsonb_build_object('available', true, 'profile_id', me);
END; $$;
REVOKE ALL ON FUNCTION public.get_my_collection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_collection() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_collection(_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  target record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _profile_id IS NULL THEN RAISE EXCEPTION 'profile required'; END IF;

  IF me = _profile_id THEN
    RETURN public._collection_payload(me, true) || jsonb_build_object('available', true, 'profile_id', me);
  END IF;

  SELECT id, deleted_at, onboarding_completed INTO target
    FROM public.profiles WHERE id = _profile_id;
  IF NOT FOUND OR target.deleted_at IS NOT NULL OR target.onboarding_completed IS NOT TRUE
     OR public.is_blocked_between(me, _profile_id) THEN
    RETURN jsonb_build_object('available', false, 'profile_id', _profile_id);
  END IF;

  RETURN public._collection_payload(_profile_id, false)
         || jsonb_build_object('available', true, 'profile_id', _profile_id);
END; $$;
REVOKE ALL ON FUNCTION public.get_public_collection(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_collection(uuid) TO authenticated;

-- Sticker state for one place (check-in success sheet and place detail).
CREATE OR REPLACE FUNCTION public.get_my_place_sticker(_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  v int := 0;
  pname text;
  pcat text;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT name, category::text INTO pname, pcat FROM public.community_places WHERE id = _place_id;
  IF pname IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT ls.visits INTO v
    FROM public._legit_place_supports(me) ls
   WHERE ls.community_place_id = _place_id;
  v := COALESCE(v, 0);

  RETURN jsonb_build_object(
    'found', true,
    'place_id', _place_id,
    'name', pname,
    'category', pcat,
    'visits', v,
    'level', public._sticker_level(v),
    'next_level_visits', CASE WHEN v >= 10 THEN NULL WHEN v >= 3 THEN 10 WHEN v >= 1 THEN 3 ELSE 1 END
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_my_place_sticker(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_place_sticker(uuid) TO authenticated;

-- Full-size photo of one card. Owner always; others only when the card is
-- public and no block exists between the two members.
CREATE OR REPLACE FUNCTION public.get_memory_card(_card_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  r record;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT mc.id, mc.profile_id, mc.meetup_id, mc.photo_data_url, mc.caption, mc.is_public, mc.created_at,
         m.title, m.date,
         COALESCE(m.city_name_snapshot, ci.name) AS city_name,
         COALESCE(p.name, m.custom_location_name, m.location_name) AS place_name,
         pr.display_name AS owner_name
    INTO r
    FROM public.meetup_memory_cards mc
    JOIN public.meetups m ON m.id = mc.meetup_id
    JOIN public.profiles pr ON pr.id = mc.profile_id
    LEFT JOIN public.community_places p ON p.id = m.community_place_id
    LEFT JOIN public.cities ci ON ci.id = m.city_id
   WHERE mc.id = _card_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('available', false); END IF;
  IF r.profile_id <> me AND (r.is_public IS NOT TRUE OR public.is_blocked_between(me, r.profile_id)) THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'id', r.id,
    'profile_id', r.profile_id,
    'owner_name', r.owner_name,
    'meetup_id', r.meetup_id,
    'title', r.title,
    'date', r.date,
    'city_name', r.city_name,
    'place_name', r.place_name,
    'photo_data_url', r.photo_data_url,
    'caption', r.caption,
    'is_public', r.is_public,
    'created_at', r.created_at
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_memory_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_memory_card(uuid) TO authenticated;

-- My card for one meetup (Meetup Summary screen), or {found:false}.
CREATE OR REPLACE FUNCTION public.get_my_memory_card(_meetup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  r record;
  eligible boolean;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT public.meetup_has_ended(_meetup_id)
         AND EXISTS (
           SELECT 1 FROM public.meetups m
            WHERE m.id = _meetup_id
              AND (m.host_id = me OR EXISTS (
                SELECT 1 FROM public.attendance a
                 WHERE a.meetup_id = m.id AND a.profile_id = me
                   AND a.status::text IN ('checked_in','attended')))
         ) INTO eligible;

  SELECT id, photo_data_url, thumb_data_url, caption, is_public, created_at, updated_at
    INTO r FROM public.meetup_memory_cards
   WHERE profile_id = me AND meetup_id = _meetup_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'eligible', COALESCE(eligible, false));
  END IF;
  RETURN jsonb_build_object(
    'found', true,
    'eligible', COALESCE(eligible, false),
    'id', r.id,
    'photo_data_url', r.photo_data_url,
    'thumb_data_url', r.thumb_data_url,
    'caption', r.caption,
    'is_public', r.is_public,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_my_memory_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_memory_card(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_meetup_memory_card(
  _meetup_id uuid,
  _photo text,
  _thumb text,
  _caption text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  m record;
  attended boolean;
  cap text;
  card_id uuid;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, host_id, status INTO m FROM public.meetups WHERE id = _meetup_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meetup not found'; END IF;
  IF m.status = 'cancelled'::meetup_status THEN
    RAISE EXCEPTION 'This meetup was cancelled, so it has no memory card.';
  END IF;
  IF NOT public.meetup_has_ended(_meetup_id) THEN
    RAISE EXCEPTION 'You can add a memory card once the meetup has ended.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.attendance a
     WHERE a.meetup_id = _meetup_id AND a.profile_id = me
       AND a.status::text IN ('checked_in','attended')
  ) INTO attended;
  IF m.host_id <> me AND NOT attended THEN
    RAISE EXCEPTION 'Only members who checked in to this meetup can add a memory card.';
  END IF;

  IF _photo IS NULL OR _photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' OR char_length(_photo) > 500000 THEN
    RAISE EXCEPTION 'That photo could not be saved. Choose a smaller JPG photo.';
  END IF;
  IF _thumb IS NULL OR _thumb !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' OR char_length(_thumb) > 80000 THEN
    RAISE EXCEPTION 'That photo could not be saved. Try another photo.';
  END IF;

  cap := left(btrim(COALESCE(_caption, '')), 80);

  INSERT INTO public.meetup_memory_cards (profile_id, meetup_id, photo_data_url, thumb_data_url, caption)
  VALUES (me, _meetup_id, _photo, _thumb, cap)
  ON CONFLICT (profile_id, meetup_id) DO UPDATE
     SET photo_data_url = EXCLUDED.photo_data_url,
         thumb_data_url = EXCLUDED.thumb_data_url,
         caption = EXCLUDED.caption
  RETURNING id INTO card_id;

  RETURN card_id;
END; $$;
REVOKE ALL ON FUNCTION public.upsert_meetup_memory_card(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_meetup_memory_card(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_memory_card_caption(_meetup_id uuid, _caption text, _is_public boolean DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  n int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.meetup_memory_cards
     SET caption = left(btrim(COALESCE(_caption, caption)), 80),
         is_public = COALESCE(_is_public, is_public)
   WHERE profile_id = me AND meetup_id = _meetup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END; $$;
REVOKE ALL ON FUNCTION public.update_memory_card_caption(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_memory_card_caption(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_meetup_memory_card(_meetup_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  me uuid;
  n int;
BEGIN
  me := public.current_profile_id();
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.meetup_memory_cards WHERE profile_id = me AND meetup_id = _meetup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END; $$;
REVOKE ALL ON FUNCTION public.delete_meetup_memory_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_meetup_memory_card(uuid) TO authenticated;

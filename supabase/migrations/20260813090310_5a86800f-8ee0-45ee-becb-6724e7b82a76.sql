-- WO-101 Community Place photo management -------------------------------------
CREATE TABLE public.community_place_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  community_place_id uuid NOT NULL REFERENCES public.community_places(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  is_cover boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX community_place_photos_place_order_idx
  ON public.community_place_photos (community_place_id, sort_order, created_at, id);

-- One-cover invariant, enforced by the database.
CREATE UNIQUE INDEX community_place_photos_one_cover_idx
  ON public.community_place_photos (community_place_id) WHERE is_cover;

GRANT SELECT ON public.community_place_photos TO anon, authenticated;
GRANT ALL ON public.community_place_photos TO service_role;

ALTER TABLE public.community_place_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Photos of active places are readable"
  ON public.community_place_photos FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.community_places p
    WHERE p.id = community_place_photos.community_place_id AND p.is_active
  ));

CREATE POLICY "Owner can read all place photos"
  ON public.community_place_photos FOR SELECT TO authenticated
  USING (public.is_owner());

-- No INSERT/UPDATE/DELETE policies: every write goes through the owner-only
-- SECURITY DEFINER RPCs below.

-- Internal: deterministic ordering, cover always at position 0. -------------
CREATE OR REPLACE FUNCTION public.normalize_community_place_photos(_place_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH ordered AS (
    SELECT id, row_number() OVER (
             ORDER BY is_cover DESC, sort_order, created_at, id
           ) - 1 AS rn
    FROM public.community_place_photos
    WHERE community_place_id = _place_id
  )
  UPDATE public.community_place_photos p
     SET sort_order = o.rn
    FROM ordered o
   WHERE p.id = o.id AND p.sort_order <> o.rn;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_community_place_photos(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.add_community_place_photo(_place_id uuid, _storage_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count int;
  _first boolean;
  _id uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.community_places WHERE id = _place_id) THEN
    RAISE EXCEPTION 'Community Place not found';
  END IF;
  IF _storage_path IS NULL
     OR _storage_path <> (_place_id::text || '/' || split_part(_storage_path, '/', 2))
     OR split_part(_storage_path, '/', 2) = ''
     OR _storage_path ~ '\.\.' THEN
    RAISE EXCEPTION 'Invalid storage path';
  END IF;

  SELECT count(*) INTO _count
    FROM public.community_place_photos WHERE community_place_id = _place_id;
  IF _count >= 8 THEN
    RAISE EXCEPTION 'Photo limit reached';
  END IF;
  _first := _count = 0;

  INSERT INTO public.community_place_photos (
    community_place_id, storage_path, sort_order, is_cover, created_by)
  VALUES (_place_id, _storage_path, _count, _first, auth.uid())
  RETURNING id INTO _id;

  PERFORM public.normalize_community_place_photos(_place_id);
  RETURN jsonb_build_object('photo_id', _id, 'photo_count_after', _count + 1, 'is_cover', _first);
END;
$$;
REVOKE ALL ON FUNCTION public.add_community_place_photo(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_community_place_photo(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_community_place_photo_cover(_photo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _place uuid; _count int;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT community_place_id INTO _place FROM public.community_place_photos WHERE id = _photo_id;
  IF _place IS NULL THEN RAISE EXCEPTION 'Photo not found'; END IF;

  UPDATE public.community_place_photos
     SET is_cover = false
   WHERE community_place_id = _place AND is_cover AND id <> _photo_id;
  UPDATE public.community_place_photos
     SET is_cover = true, sort_order = -1
   WHERE id = _photo_id;

  PERFORM public.normalize_community_place_photos(_place);
  SELECT count(*) INTO _count FROM public.community_place_photos WHERE community_place_id = _place;
  RETURN jsonb_build_object('place_id', _place, 'photo_count', _count);
END;
$$;
REVOKE ALL ON FUNCTION public.set_community_place_photo_cover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_community_place_photo_cover(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_community_place_photo(_photo_id uuid, _direction text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _place uuid; _order int; _cover boolean; _other_id uuid; _other_order int; _count int;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _direction NOT IN ('left','right') THEN RAISE EXCEPTION 'Invalid direction'; END IF;

  SELECT community_place_id, sort_order, is_cover
    INTO _place, _order, _cover
    FROM public.community_place_photos WHERE id = _photo_id;
  IF _place IS NULL THEN RAISE EXCEPTION 'Photo not found'; END IF;
  IF _cover THEN RAISE EXCEPTION 'Cover photo is always first'; END IF;

  IF _direction = 'left' THEN
    SELECT id, sort_order INTO _other_id, _other_order
      FROM public.community_place_photos
     WHERE community_place_id = _place AND NOT is_cover AND sort_order < _order
     ORDER BY sort_order DESC LIMIT 1;
  ELSE
    SELECT id, sort_order INTO _other_id, _other_order
      FROM public.community_place_photos
     WHERE community_place_id = _place AND sort_order > _order
     ORDER BY sort_order ASC LIMIT 1;
  END IF;

  IF _other_id IS NOT NULL THEN
    UPDATE public.community_place_photos SET sort_order = _order WHERE id = _other_id;
    UPDATE public.community_place_photos SET sort_order = _other_order WHERE id = _photo_id;
    PERFORM public.normalize_community_place_photos(_place);
  END IF;

  SELECT count(*) INTO _count FROM public.community_place_photos WHERE community_place_id = _place;
  RETURN jsonb_build_object('place_id', _place, 'photo_count', _count, 'moved', _other_id IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.move_community_place_photo(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_community_place_photo(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_community_place_photo(_photo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _place uuid; _path text; _was_cover boolean; _next uuid; _count int;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT community_place_id, storage_path, is_cover
    INTO _place, _path, _was_cover
    FROM public.community_place_photos WHERE id = _photo_id;
  IF _place IS NULL THEN RAISE EXCEPTION 'Photo not found'; END IF;

  DELETE FROM public.community_place_photos WHERE id = _photo_id;

  IF _was_cover THEN
    SELECT id INTO _next FROM public.community_place_photos
     WHERE community_place_id = _place
     ORDER BY sort_order, created_at, id LIMIT 1;
    IF _next IS NOT NULL THEN
      UPDATE public.community_place_photos SET is_cover = true WHERE id = _next;
    END IF;
  END IF;

  PERFORM public.normalize_community_place_photos(_place);
  SELECT count(*) INTO _count FROM public.community_place_photos WHERE community_place_id = _place;
  RETURN jsonb_build_object('place_id', _place, 'storage_path', _path, 'photo_count_after', _count);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_community_place_photo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_community_place_photo(uuid) TO authenticated;

-- Storage policies: owner writes, signed-in members read. --------------------
CREATE POLICY "Owner can upload community place photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-place-photos' AND public.is_owner());

CREATE POLICY "Owner can delete community place photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'community-place-photos' AND public.is_owner());

CREATE POLICY "Members can read community place photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'community-place-photos');

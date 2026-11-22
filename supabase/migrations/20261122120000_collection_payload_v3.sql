-- 2026-11-22 (b) — Collection payload v3.
--
-- Facts established while debugging "checked in to a meetup, no sticker":
--  * Since 2026-08-07 (_legit_place_supports) a place visit is ONLY a
--    GPS-verified check-in at the place. Meetup check-ins are honour based
--    and do not count. Stickers follow the same rule, so they stay in step
--    with Community Impact.
--  * The naive `(date + end_time) <= now()` comparisons ignore the Meetup's
--    timezone (7 h late in Vietnam). Use meetup_end_at() instead.
--
-- Changes vs 20261122110000:
--  * `attended` evidence and `stats.meetups_attended` use meetup_end_at().
--  * New `pending`: meetups the member checked in to (ongoing, or ended less
--    than 4 h ago) held at a Community Place where they have no verified
--    place check-in since the meetup started — i.e. a sticker they can still
--    collect by checking in at the place while they are there. Own view only.

CREATE OR REPLACE FUNCTION public._collection_payload(_profile uuid, _include_private boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  stickers jsonb;
  uncollected jsonb := '[]'::jsonb;
  cards jsonb;
  stats jsonb;
  evidence jsonb := NULL;
  pending jsonb := '[]'::jsonb;
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

    -- Stickers still collectable: meetup check-in done, place check-in not yet.
    SELECT COALESCE(jsonb_agg(row_to_json(q)::jsonb ORDER BY q.ends_at), '[]'::jsonb)
      INTO pending
      FROM (
        SELECT DISTINCT ON (m.community_place_id)
               p.id AS place_id,
               p.name,
               p.category::text AS category,
               c.name AS city_name,
               m.id AS meetup_id,
               m.title AS meetup_title,
               public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) AS ends_at,
               public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) + INTERVAL '4 hours' AS claim_until,
               COALESCE((SELECT ls.visits FROM public._legit_place_supports(_profile) ls
                          WHERE ls.community_place_id = p.id), 0) AS visits_so_far
          FROM public.attendance a
          JOIN public.meetups m ON m.id = a.meetup_id
          JOIN public.community_places p ON p.id = m.community_place_id
          LEFT JOIN public.cities c ON c.id = p.city_id
         WHERE a.profile_id = _profile
           AND a.status::text IN ('checked_in','attended')
           AND m.status <> 'cancelled'::meetup_status
           AND public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) + INTERVAL '4 hours' > now()
           AND public.meetup_start_at(m.date, m.start_time, m.timezone) - INTERVAL '60 minutes' <= now()
           AND NOT EXISTS (
             SELECT 1 FROM public.community_place_visits v
              WHERE v.profile_id = _profile
                AND v.community_place_id = p.id
                AND v.verification_status = 'verified'
                AND v.visited_at >= public.meetup_start_at(m.date, m.start_time, m.timezone) - INTERVAL '60 minutes'
           )
         ORDER BY m.community_place_id, m.date, m.start_time
      ) q;

    -- Evidence behind the social / hosting badges (own view only).
    SELECT jsonb_build_object(
      'connections', COALESCE((
        SELECT jsonb_agg(row_to_json(v)::jsonb ORDER BY v.verified_at DESC)
          FROM (
            SELECT vp.peer_profile_id AS profile_id,
                   CASE WHEN public.is_blocked_between(_profile, vp.peer_profile_id) THEN NULL ELSE pr.display_name END AS display_name,
                   CASE WHEN public.is_blocked_between(_profile, vp.peer_profile_id) THEN NULL ELSE pr.avatar_url END AS avatar_url,
                   vp.first_verified_at AS verified_at,
                   vp.source_meetup_id AS meetup_id,
                   m.title AS meetup_title,
                   m.date AS meetup_date
              FROM public._legit_verified_pairs(_profile) vp
              LEFT JOIN public.profiles pr ON pr.id = vp.peer_profile_id
              LEFT JOIN public.meetups m ON m.id = vp.source_meetup_id
          ) v
      ), '[]'::jsonb),
      'hosted', COALESCE((
        SELECT jsonb_agg(row_to_json(h)::jsonb ORDER BY h.date DESC)
          FROM (
            SELECT hm.meetup_id,
                   m.title,
                   m.date,
                   COALESCE(m.city_name_snapshot, ci.name) AS city_name,
                   COALESCE(p.name, m.custom_location_name, m.location_name) AS place_name,
                   (SELECT count(*)::int FROM public.attendance a
                     WHERE a.meetup_id = hm.meetup_id
                       AND a.profile_id <> _profile
                       AND a.status::text IN ('checked_in','attended')) AS checked_in_count
              FROM public._legit_hosted_meetup_ids(_profile) hm
              JOIN public.meetups m ON m.id = hm.meetup_id
              LEFT JOIN public.community_places p ON p.id = m.community_place_id
              LEFT JOIN public.cities ci ON ci.id = m.city_id
          ) h
      ), '[]'::jsonb),
      'attended', COALESCE((
        SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.date DESC)
          FROM (
            SELECT m.id AS meetup_id,
                   m.title,
                   m.date,
                   COALESCE(m.city_name_snapshot, ci.name) AS city_name,
                   COALESCE(p.name, m.custom_location_name, m.location_name) AS place_name
              FROM public.attendance a
              JOIN public.meetups m ON m.id = a.meetup_id
              LEFT JOIN public.community_places p ON p.id = m.community_place_id
              LEFT JOIN public.cities ci ON ci.id = m.city_id
             WHERE a.profile_id = _profile
               AND a.status::text IN ('checked_in','attended')
               AND m.host_id <> _profile
               AND m.status <> 'cancelled'::meetup_status
               AND public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) <= now()
          ) t
      ), '[]'::jsonb)
    ) INTO evidence;
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
         AND public.meetup_end_at(m.date, m.start_time, m.end_time, m.timezone) <= now()
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
    'stats', stats,
    'evidence', evidence,
    'pending', pending
  );
END; $$;
REVOKE ALL ON FUNCTION public._collection_payload(uuid, boolean) FROM PUBLIC, anon, authenticated;

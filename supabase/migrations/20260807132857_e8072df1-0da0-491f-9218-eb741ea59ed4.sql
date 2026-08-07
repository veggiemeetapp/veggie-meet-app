SET session_replication_role = replica;

DELETE FROM public.community_place_visits
 WHERE profile_id = '447dad9b-88fa-4fe4-91c3-97ae29b04d6c'
   AND community_place_id = '0703392f-93a9-4266-a23e-6b347e9acc89';

DELETE FROM public.verified_meetup_connections
 WHERE meetup_id = '22222222-0065-4a00-8000-000000000002';

DELETE FROM public.friendships
 WHERE first_meetup_id = '22222222-0065-4a00-8000-000000000002';

DELETE FROM public.meetup_completions
 WHERE meetup_id = '22222222-0065-4a00-8000-000000000002';

DELETE FROM public.attendance
 WHERE meetup_id = '22222222-0065-4a00-8000-000000000002';

DELETE FROM public.notifications
 WHERE entity_id IN ('22222222-0065-4a00-8000-000000000002','11111111-0065-4a00-8000-000000000001')
    OR destination_id IN ('22222222-0065-4a00-8000-000000000002','11111111-0065-4a00-8000-000000000001')
    OR actor_id = '11111111-0065-4a00-8000-000000000001'
    OR recipient_id = '11111111-0065-4a00-8000-000000000001';

DELETE FROM public.meetups
 WHERE id = '22222222-0065-4a00-8000-000000000002';

DELETE FROM public.profiles
 WHERE id = '11111111-0065-4a00-8000-000000000001';

SET session_replication_role = DEFAULT;
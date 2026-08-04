-- WO-060 QA cleanup: remove controlled fixtures, restore baseline.
ALTER TABLE public.community_place_identity_reviews DISABLE TRIGGER USER;
ALTER TABLE public.community_place_vegan_reviews DISABLE TRIGGER USER;

DELETE FROM public.community_place_identity_reviews WHERE id = '60000000-0000-4000-8000-000000000005';
DELETE FROM public.community_place_vegan_reviews    WHERE id = '60000000-0000-4000-8000-000000000004';
DELETE FROM public.community_place_reverifications  WHERE id = '60000000-0000-4000-8000-000000000003';
DELETE FROM public.community_place_reports          WHERE id = '60000000-0000-4000-8000-000000000002';
DELETE FROM public.notifications
 WHERE entity_id IN ('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002');
DELETE FROM public.community_place_suggestions      WHERE id = '60000000-0000-4000-8000-000000000001';

ALTER TABLE public.community_place_identity_reviews ENABLE TRIGGER USER;
ALTER TABLE public.community_place_vegan_reviews ENABLE TRIGGER USER;

UPDATE public.community_places
   SET is_active = true, maintenance_status = 'operational'
 WHERE id = 'df8ef9f6-55e1-4e67-a563-8acefbad40d2';
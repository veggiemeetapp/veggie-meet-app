-- WO-060 controlled QA fixtures (removed in the following cleanup migration).
INSERT INTO public.community_place_suggestions
  (id, submitted_by, place_name, address_text, official_source_url, vegan_reason, moderation_status, submitted_at)
VALUES
  ('60000000-0000-4000-8000-000000000001',
   '447dad9b-88fa-4fe4-91c3-97ae29b04d6c',
   'WO060 QA Suggestion Place',
   '1 QA Street, District 1, Ho Chi Minh City',
   'https://example.com/wo060-qa',
   'QA fixture — 100% vegan menu stated on the official site.',
   'pending', now() - INTERVAL '2 days');

INSERT INTO public.community_place_reports
  (id, community_place_id, reporter_profile_id, reason_code, explanation, status, created_at)
VALUES
  ('60000000-0000-4000-8000-000000000002',
   '0703392f-93a9-4266-a23e-6b347e9acc89',
   '447dad9b-88fa-4fe4-91c3-97ae29b04d6c',
   'not_fully_vegan',
   'WO060 QA fixture report explanation for dashboard verification.',
   'pending', now() - INTERVAL '1 day');

INSERT INTO public.community_place_reverifications
  (id, community_place_id, status, started_by, started_at)
VALUES
  ('60000000-0000-4000-8000-000000000003',
   'df8ef9f6-55e1-4e67-a563-8acefbad40d2',
   'in_progress', '447dad9b-88fa-4fe4-91c3-97ae29b04d6c', now() - INTERVAL '3 hours');

INSERT INTO public.community_place_vegan_reviews
  (id, community_place_id, status, started_by, started_at)
VALUES
  ('60000000-0000-4000-8000-000000000004',
   '0deae6cc-253e-487d-a5e0-926c9d850d13',
   'in_progress', '447dad9b-88fa-4fe4-91c3-97ae29b04d6c', now() - INTERVAL '2 hours');

INSERT INTO public.community_place_identity_reviews
  (id, community_place_id, status, started_by, started_at)
VALUES
  ('60000000-0000-4000-8000-000000000005',
   '0703392f-93a9-4266-a23e-6b347e9acc89',
   'in_progress', '447dad9b-88fa-4fe4-91c3-97ae29b04d6c', now() - INTERVAL '1 hour');

-- Temporarily hidden + temporarily closed state (restored in cleanup).
UPDATE public.community_places
   SET is_active = false, maintenance_status = 'temporarily_closed'
 WHERE id = 'df8ef9f6-55e1-4e67-a563-8acefbad40d2';
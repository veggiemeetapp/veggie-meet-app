DELETE FROM public.user_blocks
 WHERE blocker_profile_id='6d91280c-4551-44e0-8edf-485bd9b5e638'
   AND blocked_profile_id='4294f23a-9347-41f1-96ad-016e115d7d2c';

DELETE FROM public.recommendation_feedback
 WHERE reason_code IN ('test_hide','test_hide2','test_sf');
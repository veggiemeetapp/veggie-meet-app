ALTER TABLE public.meetup_completions DISABLE TRIGGER guard_meetup_completions_ud;
DELETE FROM public.meetup_completions
 WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO079A%');
ALTER TABLE public.meetup_completions ENABLE TRIGGER guard_meetup_completions_ud;
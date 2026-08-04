-- WO-053 QA cleanup: remove all temporary artifacts created during QA of the
-- Community Place status maintenance workflow. Restores the clean baseline
-- (3 operational published places, 0 meetups, 0 visits, 0 notifications, 0 history).

DELETE FROM public.attendance
WHERE meetup_id IN (SELECT id FROM public.meetups WHERE title LIKE 'WO053 QA%');

DELETE FROM public.meetups WHERE title LIKE 'WO053 QA%';

DELETE FROM public.community_place_visits;

DELETE FROM public.notifications;

DELETE FROM public.community_place_status_history;

UPDATE public.community_places
SET maintenance_status = 'operational',
    status_note = NULL,
    status_changed_at = NULL,
    status_changed_by = NULL
WHERE maintenance_status <> 'operational'
   OR status_note IS NOT NULL
   OR status_changed_by IS NOT NULL;
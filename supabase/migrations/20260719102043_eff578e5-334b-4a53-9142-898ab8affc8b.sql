-- WO-029 QA-driven fixes

-- 1) Exclude removed attendees from cancellation fan-out
CREATE OR REPLACE FUNCTION public.handle_meetup_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  attendee RECORD;
  changed_fields text[] := ARRAY[]::text[];
  change_summary text;
  dedup text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  IF NEW.status = 'cancelled'::meetup_status
     AND OLD.status IS DISTINCT FROM 'cancelled'::meetup_status THEN
    dedup := 'meetup:' || NEW.id::text || ':cancelled';
    FOR attendee IN
      SELECT DISTINCT a.profile_id
        FROM public.attendance a
       WHERE a.meetup_id = NEW.id
         AND a.status::text NOT IN ('cancelled','removed')
         AND a.profile_id <> NEW.host_id
    LOOP
      PERFORM public._insert_notification(
        attendee.profile_id, NEW.host_id, 'meetup_cancelled',
        'meetup', NEW.id, 'meetup', NEW.id, NULL,
        COALESCE(NEW.title,'A Meetup') || ' was cancelled.',
        jsonb_build_object('meetup_id', NEW.id),
        dedup
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled'::meetup_status THEN RETURN NEW; END IF;

  IF OLD.title IS DISTINCT FROM NEW.title THEN
    changed_fields := array_append(changed_fields, 'title');
  END IF;
  IF OLD.date IS DISTINCT FROM NEW.date
     OR OLD.start_time IS DISTINCT FROM NEW.start_time
     OR OLD.end_time IS DISTINCT FROM NEW.end_time THEN
    changed_fields := array_append(changed_fields, 'time');
  END IF;
  IF OLD.community_place_id IS DISTINCT FROM NEW.community_place_id
     OR OLD.custom_location_name IS DISTINCT FROM NEW.custom_location_name
     OR OLD.custom_location_address IS DISTINCT FROM NEW.custom_location_address THEN
    changed_fields := array_append(changed_fields, 'location');
  END IF;

  IF array_length(changed_fields,1) IS NULL THEN RETURN NEW; END IF;

  change_summary := CASE
    WHEN array_length(changed_fields,1) = 1 THEN 'its ' || changed_fields[1]
    WHEN array_length(changed_fields,1) = 2 THEN 'its ' || changed_fields[1] || ' and ' || changed_fields[2]
    ELSE 'its ' || array_to_string(changed_fields[1:array_length(changed_fields,1)-1], ', ') || ', and ' || changed_fields[array_length(changed_fields,1)]
  END;

  dedup := 'meetup:' || NEW.id::text || ':update:' || extract(epoch from NEW.updated_at)::text;

  FOR attendee IN
    SELECT DISTINCT a.profile_id
      FROM public.attendance a
     WHERE a.meetup_id = NEW.id
       AND a.status::text NOT IN ('cancelled','removed')
       AND a.profile_id <> NEW.host_id
  LOOP
    PERFORM public._insert_notification(
      attendee.profile_id, NEW.host_id, 'meetup_updated',
      'meetup', NEW.id, 'meetup', NEW.id, NULL,
      COALESCE(NEW.title,'A Meetup') || ' changed ' || change_summary || '.',
      jsonb_build_object('meetup_id', NEW.id, 'changed_fields', to_jsonb(changed_fields)),
      dedup
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 2) Keep private removal reason and removed_by out of general reads.
-- Replace the permissive attendance SELECT policy with a column-safe pair:
--   * a public view / policy path that hides sensitive columns
--   * a self-only path that exposes them to the affected attendee
-- Simpler approach: keep row visible, revoke columns from anon/authenticated,
-- and add a self-only column grant via a security definer function.
REVOKE ALL ON public.attendance FROM anon, authenticated;
GRANT SELECT (id, profile_id, meetup_id, status, joined_at, checked_in_at, created_at, updated_at, removed_at)
  ON public.attendance TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;

-- Self-serve read of the private fields via RPC (only the removed attendee sees them).
CREATE OR REPLACE FUNCTION public.get_my_removal_details(_meetup_id uuid)
RETURNS TABLE(removal_reason text, removed_at timestamptz, removed_by uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.removal_reason, a.removed_at, a.removed_by
    FROM public.attendance a
   WHERE a.meetup_id = _meetup_id
     AND a.profile_id = public.current_profile_id()
     AND a.status = 'removed'::attendance_status
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_removal_details(uuid) TO authenticated;
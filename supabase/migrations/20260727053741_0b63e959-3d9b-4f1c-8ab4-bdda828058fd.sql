CREATE OR REPLACE FUNCTION public.to_plan(r anyelement)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  RETURN jsonb_build_object(
    'plan_type', r.plan_type,
    'meetup_id', r.meetup_id,
    'title', r.title,
    'image', r.cover_image_url,
    'category', r.category,
    'role', CASE WHEN r.is_host THEN 'host'
                 WHEN r.is_checked_in THEN 'checked_in'
                 WHEN r.att_status IS NOT NULL THEN 'attendee'
                 WHEN r.invitation_id IS NOT NULL THEN 'invitee'
                 ELSE 'viewer' END,
    'date', r.date,
    'start_time', r.start_time,
    'end_time', r.end_time,
    'timezone', r.timezone,
    'starts_at', r.starts_at,
    'ends_at', r.ends_at,
    'meetup_status', r.meetup_status,
    'host', jsonb_build_object('id', r.host_id, 'name', r.host_name, 'avatar', r.host_avatar),
    'location', jsonb_build_object(
      'city', r.city_name_snapshot,
      'neighborhood', r.neighborhood,
      'name', r.location_name,
      'address', r.address
    ),
    'capacity', r.capacity,
    'attendee_count', r.attendee_count,
    'attendance_state', r.att_status,
    'invitation', CASE WHEN r.invitation_id IS NULL THEN NULL ELSE
      jsonb_build_object('id', r.invitation_id, 'message', r.invitation_message,
        'status', r.invitation_status, 'sender_id', r.invitation_sender_id)
      END,
    'has_unseen_update', r.has_unseen_update,
    'primary_action', CASE r.plan_type
      WHEN 'active' THEN CASE WHEN r.is_checked_in THEN 'open_chat' ELSE 'check_in' END
      WHEN 'update' THEN 'view_meetup'
      WHEN 'cancelled' THEN 'view_meetup'
      WHEN 'invitation' THEN 'review_invitation'
      WHEN 'hosting' THEN 'manage_meetup'
      WHEN 'upcoming' THEN 'view_meetup'
      WHEN 'follow_up' THEN 'view_summary'
      WHEN 'past' THEN 'view_summary'
      ELSE 'view_meetup' END,
    'reason_code', r.plan_type,
    'reason_label', CASE r.plan_type
      WHEN 'active' THEN 'Happening now'
      WHEN 'update' THEN 'Meetup updated'
      WHEN 'cancelled' THEN 'Meetup cancelled'
      WHEN 'invitation' THEN 'Invitation received'
      WHEN 'hosting' THEN 'You''re hosting'
      WHEN 'upcoming' THEN 'You''re going'
      WHEN 'follow_up' THEN 'Reflect on this Meetup'
      WHEN 'past' THEN 'Attended'
      ELSE NULL END
  );
END $function$;
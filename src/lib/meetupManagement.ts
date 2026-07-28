import { supabase } from "@/integrations/supabase/client";

export interface ManagedAttendee {
  attendanceId: string;
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  joinedAt: string | null;
}

/**
 * Fetch currently-attending Veggies for a Meetup (host + active attendees).
 * Excludes cancelled and removed rows.
 */
export async function fetchMeetupAttendees(meetupId: string): Promise<ManagedAttendee[]> {
  const { data, error } = await supabase
    .from("attendance")
    .select(
      "id, profile_id, status, joined_at, profiles!attendance_profile_id_fkey(id, display_name, avatar_url)",
    )
    .eq("meetup_id", meetupId)
    .not("status", "in", "(cancelled,removed)")
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    attendanceId: r.id,
    profileId: r.profile_id,
    displayName: r.profiles?.display_name ?? "",
    avatarUrl: r.profiles?.avatar_url ?? null,
    status: r.status,
    joinedAt: r.joined_at,
  }));
}

export interface UpdateHostedMeetupInput {
  meetupId: string;
  title: string;
  description: string;
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  capacity: number;
  communityPlaceId: string | null;
  customLocationName: string | null;
  customLocationAddress: string | null;
  coverImageUrl: string | null;
}

export async function updateHostedMeetup(input: UpdateHostedMeetupInput): Promise<void> {
  const { error } = await supabase.rpc("update_hosted_meetup", {
    _meetup_id: input.meetupId,
    _title: input.title,
    _description: input.description,
    _date: input.date,
    _start_time: input.startTime,
    _end_time: input.endTime,
    _capacity: input.capacity,
    _community_place_id: input.communityPlaceId,
    _custom_location_name: input.customLocationName,
    _custom_location_address: input.customLocationAddress,
    _cover_image_url: input.coverImageUrl,
  });
  if (error) throw new Error(error.message);
}

export async function cancelMeetup(meetupId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_meetup", {
    _meetup_id: meetupId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function removeMeetupAttendee(
  meetupId: string,
  attendeeProfileId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("remove_meetup_attendee", {
    _meetup_id: meetupId,
    _attendee_id: attendeeProfileId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}

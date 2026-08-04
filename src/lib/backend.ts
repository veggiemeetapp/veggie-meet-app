import { supabase } from "@/integrations/supabase/client";
import type { Meetup, Message, MeetupCategory, MeetupLocationSource, MeetupStatus, MessageType, Veggie, CommunityPlace, CommunityPlaceCategory } from "@/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;
export const isUuid = (v?: string | null) => !!v && UUID_RE.test(v);

export const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80";

/** Blob/object URLs die on refresh — treat them (and empties) as missing. */
export function sanitizeCover(url?: string | null): string {
  if (!url || url.startsWith("blob:")) return FALLBACK_COVER;
  return url;
}


interface DBMeetupRow {
  id: string;
  title: string;
  description: string;
  category: string;
  host_id: string;
  community_place_id: string | null;
  custom_location_name: string | null;
  custom_location_address: string | null;
  cover_image_url: string | null;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: string;
  chats?: { id: string }[] | null;
  city_id?: string | null;
  city_name_snapshot?: string | null;
  country_code_snapshot?: string | null;
  timezone?: string | null;
  neighborhood?: string | null;
  location_name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_source?: "community_place" | "custom_location" | "unknown" | null;
  location_is_inferred?: boolean | null;
}

function toMeetup(row: DBMeetupRow): Meetup {
  const source = (row.location_source ?? (row.community_place_id ? "community_place" : row.custom_location_name ? "custom_location" : "unknown"));
  const locationName = row.location_name ?? row.custom_location_name ?? null;
  const address = row.address ?? row.custom_location_address ?? null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    category: (row.category as MeetupCategory) ?? "other",
    hostId: row.host_id,
    communityPlaceId: row.community_place_id ?? "",
    coverImageUrl: sanitizeCover(row.cover_image_url),
    date: row.date,
    startTime: (row.start_time || "").slice(0, 5),
    endTime: (row.end_time || "").slice(0, 5),
    attendeeIds: [row.host_id],
    capacity: row.capacity,
    status: (row.status as MeetupStatus) ?? "upcoming",
    chatId: row.chats?.[0]?.id ?? "",
    customLocation: locationName
      ? { name: locationName, address: address ?? undefined }
      : undefined,
    location: {
      cityId: row.city_id ?? null,
      cityName: row.city_name_snapshot ?? null,
      countryCode: row.country_code_snapshot ?? null,
      timezone: row.timezone ?? null,
      neighborhood: row.neighborhood ?? null,
      locationName,
      address,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      locationSource: source as MeetupLocationSource,
      isInferred: row.location_is_inferred ?? false,
    },
  };
}

export async function fetchMeetupsForDate(date: string): Promise<Meetup[]> {
  const { data, error } = await supabase
    .from("meetups")
    .select("*, chats(id)")
    .eq("date", date)
    .order("start_time");
  if (error || !data) return [];
  return (data as unknown as DBMeetupRow[]).map(toMeetup);
}

export async function fetchUpcomingMeetups(afterDate: string): Promise<Meetup[]> {
  const { data, error } = await supabase
    .from("meetups")
    .select("*, chats(id)")
    .gt("date", afterDate)
    .order("date")
    .order("start_time");
  if (error || !data) return [];
  return (data as unknown as DBMeetupRow[]).map(toMeetup);
}

export async function fetchMeetupById(id: string): Promise<Meetup | null> {
  const { data, error } = await supabase
    .from("meetups")
    .select("*, chats(id)")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return toMeetup(data as unknown as DBMeetupRow);
}

/** Upcoming meetups hosted by this profile (today and later). */
export async function fetchHostedMeetups(
  profileId: string,
  fromDate: string,
): Promise<Meetup[]> {
  const { data, error } = await supabase
    .from("meetups")
    .select("*, chats(id)")
    .eq("host_id", profileId)
    .gte("date", fromDate)
    .order("date")
    .order("start_time");
  if (error || !data) return [];
  return (data as unknown as DBMeetupRow[]).map(toMeetup);
}

/** Upcoming meetups this profile is attending (excluding ones they host). */
export async function fetchAttendingMeetups(
  profileId: string,
  fromDate: string,
): Promise<Meetup[]> {
  const { data, error } = await supabase
    .from("attendance")
    .select("meetup_id, status, meetups!inner(*, chats(id))")
    .eq("profile_id", profileId)
    .not("status", "in", "(cancelled,removed)");
  if (error || !data) return [];
  const rows = (data as unknown as Array<{ meetups: DBMeetupRow }>).map(
    (r) => r.meetups,
  );
  return rows
    .filter((m) => m && m.host_id !== profileId && m.date >= fromDate)
    .sort((a, b) =>
      a.date === b.date
        ? a.start_time.localeCompare(b.start_time)
        : a.date.localeCompare(b.date),
    )
    .map(toMeetup);
}

export async function fetchChatIdForMeetup(meetupId: string): Promise<string | null> {
  const { data } = await supabase
    .from("chats")
    .select("id")
    .eq("meetup_id", meetupId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function fetchMessages(chatId: string): Promise<Message[]> {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at");
  return (data ?? []).map((m) => ({
    id: m.id as string,
    chatId: m.chat_id as string,
    senderId: (m.sender_id as string | null) ?? "system",
    body: m.body as string,
    createdAt: m.created_at as string,
    type: m.type as MessageType,
  }));
}

export async function sendMessage(
  chatId: string,
  senderProfileId: string,
  body: string,
): Promise<Message | null> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ chat_id: chatId, sender_id: senderProfileId, body, type: "user" })
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    chatId: data.chat_id as string,
    senderId: (data.sender_id as string | null) ?? "system",
    body: data.body as string,
    createdAt: data.created_at as string,
    type: data.type as MessageType,
  };
}

export async function hasAttendance(
  profileId: string,
  meetupId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("attendance")
    .select("id, status")
    .eq("profile_id", profileId)
    .eq("meetup_id", meetupId)
    .not("status", "in", "(cancelled,removed)")
    .limit(1);
  if (error) {
    console.error("[hasAttendance] query error", error);
    throw error;
  }
  return (data?.length ?? 0) > 0;
}

/** Was this profile removed from this meetup by the host? */
export async function wasRemovedFromMeetup(
  profileId: string,
  meetupId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("attendance")
    .select("id")
    .eq("profile_id", profileId)
    .eq("meetup_id", meetupId)
    .eq("status", "removed")
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export type MeetupRole = "host" | "attendee" | "visitor" | "removed";

export async function getMeetupRole(
  profileId: string | undefined,
  meetup: Pick<Meetup, "id" | "hostId">,
): Promise<MeetupRole> {
  if (!profileId) return "visitor";
  if (profileId === meetup.hostId) return "host";
  if (await hasAttendance(profileId, meetup.id)) return "attendee";
  if (await wasRemovedFromMeetup(profileId, meetup.id)) return "removed";
  return "visitor";
}

export async function fetchMyRemovalDetails(
  meetupId: string,
): Promise<{ reason: string | null; removedAt: string | null } | null> {
  const { data, error } = await supabase.rpc("get_my_removal_details", {
    _meetup_id: meetupId,
  });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : (data as any);
  return { reason: row.removal_reason ?? null, removedAt: row.removed_at ?? null };
}

/**
 * Ensure the user is a chat participant for a meetup's chat.
 * Repairs missing participant rows and returns the chat id (or null).
 */
export async function ensureChatMembership(
  profileId: string,
  meetupId: string,
): Promise<string | null> {
  const chatId = await fetchChatIdForMeetup(meetupId);
  if (!chatId) return null;
  await supabase
    .from("chat_participants")
    .upsert(
      { chat_id: chatId, profile_id: profileId },
      { onConflict: "chat_id,profile_id", ignoreDuplicates: true },
    );
  return chatId;
}

/**
 * Idempotent join via canonical RPC. All capacity/status/time/duplicate
 * checks live server-side (join_meetup + enforce_meetup_attendance trigger).
 * Returns { ok: true, chatId } on success, or throws with a user-facing message.
 */
export async function joinMeetup(
  _profileId: string,
  meetupId: string,
): Promise<{ ok: true; chatId: string | null }> {
  const { error } = await supabase.rpc("join_meetup", { _meetup_id: meetupId });
  if (error) {
    // Surface the DB-raised, user-facing message ("This Meetup is full.", etc.)
    throw new Error(error.message);
  }
  const chatId = await ensureChatMembership(_profileId, meetupId);
  // First meaningful action is recorded server-side via trg_activation_attendance.
  // Notification-worthy action → contextual (one-shot) permission prompt.
  try {
    const { maybePromptForNotifications } = await import("@/lib/notificationPrompt");
    maybePromptForNotifications();
  } catch { /* non-blocking */ }
  return { ok: true, chatId };
}



/** Fetch a backend profile mapped to the app's Veggie shape (for host cards etc.). */
export async function fetchProfileAsVeggie(profileId: string): Promise<Veggie | null> {
  const { data } = await supabase
    .from("profiles")
    .select(
      "id, display_name, avatar_url, bio, current_city, interests, created_at, meetups_hosted_count, meetups_attended_count, veggies_met_count, is_active_host",
    )
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    displayName: data.display_name,
    avatarUrl: data.avatar_url ?? "",
    bio: data.bio ?? "",
    homeCity: data.current_city ?? "",
    currentCity: data.current_city ?? "",
    interests: data.interests ?? [],
    memberSince: data.created_at,
    meetupsHostedCount: data.meetups_hosted_count ?? 0,
    meetupsAttendedCount: data.meetups_attended_count ?? 0,
    veggiesMetCount: data.veggies_met_count ?? 0,
    isActiveHost: data.is_active_host ?? false,
  };
}


/* ============================================================
 * City-scoped discovery (WO-035 Phase 3)
 * ============================================================
 * All discovery reads use persisted `city_id` — never text.
 * Callers should pass Selected City from get_my_location_context.
 */

const PLACE_CATEGORY_ALLOWLIST: CommunityPlaceCategory[] = [
  "restaurant",
  "cafe",
  "park",
  "market",
  "studio",
  "venue",
];

interface DBCommunityPlaceRow {
  id: string;
  name: string;
  category: string;
  address: string | null;
  cover_image_url: string | null;
  upcoming_meetups_count: number | null;
  meetups_this_month: number | null;
  veggies_visited_count: number | null;
  city_id: string | null;
  neighborhood: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean | null;
  description?: string | null;
  veggie_reason?: string | null;
  website_url?: string | null;
  google_maps_url?: string | null;
  veggie_classification?: string | null;
  maintenance_status?: string | null;
  last_reverified_at?: string | null;
  cities?: { name: string | null } | null;
}

function toCommunityPlace(row: DBCommunityPlaceRow): CommunityPlace {
  const cat: CommunityPlaceCategory = (PLACE_CATEGORY_ALLOWLIST as string[]).includes(row.category)
    ? (row.category as CommunityPlaceCategory)
    : "venue";
  return {
    id: row.id,
    name: row.name,
    category: cat,
    address: row.address ?? "",
    coverImageUrl: sanitizeCover(row.cover_image_url),
    hasCoverImage: !!row.cover_image_url && !row.cover_image_url.startsWith("blob:"),
    upcomingMeetupsCount: row.upcoming_meetups_count ?? 0,
    meetupsThisMonth: row.meetups_this_month ?? 0,
    veggiesVisitedCount: row.veggies_visited_count ?? 0,
    cityId: row.city_id,
    cityName: row.cities?.name ?? null,
    neighborhood: row.neighborhood,
    timezone: row.timezone,
    latitude: row.latitude,
    longitude: row.longitude,
    description: row.description ?? null,
    veggieReason: row.veggie_reason ?? null,
    websiteUrl: row.website_url ?? null,
    googleMapsUrl: row.google_maps_url ?? null,
    veggieClassification: row.veggie_classification ?? null,
    isActive: row.is_active !== false,
    maintenanceStatus:
      (row.maintenance_status as CommunityPlace["maintenanceStatus"]) ?? "operational",
  };
}


/**
 * WO-053 — public place columns. The owner reason note (status_note) and
 * status_changed_by are deliberately excluded: they are internal-only and are
 * readable exclusively through the owner-only maintenance RPCs.
 */
const PUBLIC_PLACE_COLUMNS = "id,name,category,address,cover_image_url,upcoming_meetups_count,meetups_this_month,veggies_visited_count,created_at,updated_at,city_id,neighborhood,timezone,latitude,longitude,is_active,google_place_id,google_maps_url,verification_status,verified_at,source,business_status,image_rights_status,description,veggie_reason,website_url,veggie_classification,maintenance_status,status_changed_at,last_reverified_at, cities(name)";

/**
 * WO-053 — the single discovery eligibility rule shared by every browse surface:
 * published + verified + active + maintenance_status = operational.
 * Direct place routes deliberately bypass this so historical pages stay readable.
 */
export async function fetchCommunityPlacesByCity(cityId: string): Promise<CommunityPlace[]> {
  const { data, error } = await supabase
    .from("community_places")
    .select(PUBLIC_PLACE_COLUMNS)
    .eq("city_id", cityId)
    .eq("verification_status", "verified")
    .eq("maintenance_status", "operational")
    .neq("is_active", false)
    .order("name");
  if (error || !data) return [];
  return (data as unknown as DBCommunityPlaceRow[]).map(toCommunityPlace);
}

/**
 * Published Community Places for the discovery list (WO-044) and the Host picker.
 * Reads ONLY from community_places — never place_candidates. Restricted to
 * verified + active + operational records; closed businesses are excluded.
 */
export async function fetchPublishedCommunityPlaces(
  cityId: string | null,
): Promise<CommunityPlace[]> {
  let q = supabase
    .from("community_places")
    .select(PUBLIC_PLACE_COLUMNS)
    .eq("verification_status", "verified")
    .eq("maintenance_status", "operational")
    .neq("is_active", false);
  if (cityId) q = q.eq("city_id", cityId);
  const { data, error } = await q.order("name");
  if (error || !data) return [];
  return (data as unknown as (DBCommunityPlaceRow & { business_status?: string | null })[])
    .filter((r) => !r.business_status || r.business_status === "OPERATIONAL")
    .map(toCommunityPlace);
}

/** All active Community Places in a city plus one selected by id (for host picker). */
export async function fetchCommunityPlaceById(placeId: string): Promise<CommunityPlace | null> {
  const { data, error } = await supabase
    .from("community_places")
    .select(PUBLIC_PLACE_COLUMNS)
    .eq("id", placeId)
    .maybeSingle();
  if (error || !data) return null;
  return toCommunityPlace(data as unknown as DBCommunityPlaceRow);
}

/** Upcoming Meetups filtered by persisted meetup.city_id. */
export async function fetchUpcomingMeetupsByCity(
  cityId: string,
  fromDate: string,
): Promise<Meetup[]> {
  const { data, error } = await supabase
    .from("meetups")
    .select("*, chats(id)")
    .eq("city_id", cityId)
    .gte("date", fromDate)
    .neq("status", "cancelled")
    .order("date")
    .order("start_time")
    .limit(40);
  if (error || !data) return [];
  return (data as unknown as DBMeetupRow[]).map(toMeetup);
}

export interface NearbyVeggie {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  interests: string[];
  cityName: string | null;
  isActiveHost: boolean;
}

/**
 * People discovery filtered by Selected City using persisted `home_city_id`.
 * Excludes blocked users (either direction), the viewer, and admins.
 * Home City is public-profile context only; Selected City drives what shows.
 */
export async function fetchNearbyVeggiesByCity(
  cityId: string,
  meProfileId: string,
  limit = 12,
): Promise<NearbyVeggie[]> {
  // Blocks (either direction) — never surface a blocked pair.
  const { data: blockRows } = await supabase
    .from("user_blocks")
    .select("blocker_profile_id, blocked_profile_id")
    .or(`blocker_profile_id.eq.${meProfileId},blocked_profile_id.eq.${meProfileId}`);
  const blocked = new Set<string>();
  (blockRows ?? []).forEach((b) => {
    blocked.add(b.blocker_profile_id as string);
    blocked.add(b.blocked_profile_id as string);
  });

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, interests, is_active_host, home_city_id, cities:home_city_id(name)")
    .eq("home_city_id", cityId)
    .eq("discovery_visible", true)
    .neq("id", meProfileId)
    .limit(limit + blocked.size + 4);
  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    interests: string[] | null;
    is_active_host: boolean | null;
    cities: { name: string | null } | null;
  }>)
    .filter((p) => !blocked.has(p.id))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      interests: p.interests ?? [],
      cityName: p.cities?.name ?? null,
      isActiveHost: !!p.is_active_host,
    }));
}




/**
 * WO-051 — Upcoming Meetups hosted at a specific Community Place.
 * Uses the (community_place_id, date, start_time) index; cancelled excluded.
 */
export async function fetchUpcomingMeetupsAtPlace(
  placeId: string,
  fromDate: string,
): Promise<Meetup[]> {
  const { data, error } = await supabase
    .from("meetups")
    .select("*, chats(id)")
    .eq("community_place_id", placeId)
    .gte("date", fromDate)
    .neq("status", "cancelled")
    .order("date")
    .order("start_time")
    .limit(20);
  if (error || !data) return [];
  return (data as unknown as DBMeetupRow[]).map(toMeetup);
}

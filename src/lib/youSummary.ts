import { supabase } from "@/integrations/supabase/client";
import { sanitizeCover } from "@/lib/backend";
import { normalizeClockTime } from "@/lib/format";

import type { Meetup, MeetupCategory, MeetupStatus } from "@/types";

/**
 * WO-087 — `/you` data access consolidation.
 *
 * `/you` previously fanned out to 5 direct table reads (meetups ×2,
 * attendance ×3) through three independent hooks. `get_my_you_summary` is the
 * single bounded, server-authoritative read model for the Meetup blocks on the
 * profile surface. Community Impact intentionally stays on its own canonical
 * RPC (`get_my_community_impact`) — this summary never recomputes impact.
 *
 * Bounds: upcoming/hosting are hard-capped server side (10 each); history is a
 * short preview (default 8, clamped 1..10). My Plans remains the canonical
 * paginated history surface, so `/you` needs no cursor pagination.
 */

export type YouLifecycleState =
  | "upcoming"
  | "in_progress"
  | "ended"
  | "completed"
  | "cancelled";

export interface YouMeetupCard {
  meetup_id: string;
  title: string;
  category: string;
  cover_image_url: string | null;
  date: string;
  start_time: string;
  end_time: string | null;
  timezone: string | null;
  capacity: number;
  attendee_count: number;
  city_name: string | null;
  neighborhood: string | null;
  location_name: string | null;
  address: string | null;
  community_place_id: string | null;
  meetup_status: string;
  lifecycle_state: YouLifecycleState;
  is_host: boolean;
  attendance_status: string | null;
}

export interface YouHistoryItem {
  meetup_id: string;
  title: string;
  date: string;
  start_time: string;
  cover_image_url: string | null;
  is_host: boolean;
  attendance_status: string | null;
  cancelled: boolean;
  lifecycle_state: YouLifecycleState;
}

export interface YouSummary {
  hosting: YouMeetupCard[];
  going: YouMeetupCard[];
  history: YouHistoryItem[];
  counts: {
    hosting_upcoming: number;
    going_upcoming: number;
    history_total: number;
  };
  history_limit: number;
  history_has_more: boolean;
  server_time: string;
}

export async function fetchMyYouSummary(historyLimit = 8): Promise<YouSummary> {
  const { data, error } = await (supabase.rpc as any)("get_my_you_summary", {
    _history_limit: historyLimit,
  });
  if (error) throw error;
  return data as YouSummary;
}

/** Presentation adapter: server card -> the `Meetup` shape `MeetupCard` renders. */
export function toMeetupCardShape(card: YouMeetupCard, myProfileId: string): Meetup {
  return {
    id: card.meetup_id,
    title: card.title,
    description: "",
    category: (card.category as MeetupCategory) ?? "other",
    hostId: card.is_host ? myProfileId : "",
    communityPlaceId: card.community_place_id ?? "",
    coverImageUrl: sanitizeCover(card.cover_image_url),
    date: card.date,
    startTime: (card.start_time || "").slice(0, 5),
    endTime: normalizeClockTime(card.end_time),
    // Server-authoritative count; `/you` never needs per-attendee identities.
    attendeeIds: Array.from({ length: Math.max(card.attendee_count, 0) }, (_, i) => `count:${i}`),
    capacity: card.capacity,
    status: (card.meetup_status as MeetupStatus) ?? "upcoming",
    chatId: "",
    customLocation: card.location_name
      ? { name: card.location_name, address: card.address ?? undefined }
      : undefined,
    location: {
      cityId: null,
      cityName: card.city_name,
      countryCode: null,
      timezone: card.timezone,
      neighborhood: card.neighborhood,
      locationName: card.location_name,
      address: card.address,
      // WO-061A/WO-078: coordinates are never returned to members.
      latitude: null,
      longitude: null,
      locationSource: card.community_place_id ? "community_place" : "custom_location",
      isInferred: false,
    },
  };
}

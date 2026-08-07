import { supabase } from "@/integrations/supabase/client";

/**
 * WO-061 — Community Place detail community layer.
 *
 * One narrow, member-safe RPC (`get_community_place_detail`) powers the whole
 * page: approved public place fields, the member's own verified visit summary,
 * privacy-thresholded aggregates and the next upcoming public Meetups.
 *
 * The RPC never returns coordinates, Google Place IDs, owner notes,
 * verification evidence, candidate data, reporter identities or attendee lists.
 * Check-in itself continues to use the dedicated secure RPC in `placeVisits.ts`.
 */

export type VerificationFreshness = "recent" | "due_soon" | "refresh_pending";

export interface PlaceDetailPlace {
  id: string;
  name: string;
  category: string;
  neighborhood: string | null;
  address: string | null;
  cover_image_url: string | null;
  has_cover_image: boolean;
  description: string | null;
  veggie_reason: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  veggie_classification: string | null;
  maintenance_status: string;
  verification_freshness: VerificationFreshness;
  last_verified_at: string | null;
}

export interface PlaceDetailMySupport {
  verified_visit_count: number;
  last_verified_visit_at: string | null;
  counts_toward_supported_places: boolean;
  total_distinct_places_supported: number;
  check_in_available: boolean;
  in_cooldown: boolean;
}

export interface PlaceDetailImpact {
  supporter_count: number | null;
  supporter_threshold_met: boolean;
  upcoming_meetups: number;
  meetups_hosted: number;
}

export interface PlaceDetailMeetup {
  id: string;
  title: string;
  category: string;
  date: string;
  start_time: string;
  end_time: string | null;
  status: string;
  capacity: number;
  attendee_count: number;
  host_display_name: string | null;
  host_avatar_url: string | null;
}

export interface PlaceDetail {
  found: boolean;
  place?: PlaceDetailPlace;
  my_support?: PlaceDetailMySupport;
  impact?: PlaceDetailImpact;
  upcoming_meetups: PlaceDetailMeetup[];
  upcoming_meetups_total: number;
  can_host_here: boolean;
}

export async function fetchCommunityPlaceDetail(placeId: string): Promise<PlaceDetail> {
  const { data, error } = await (supabase.rpc as any)("get_community_place_detail", {
    _place_id: placeId,
  });
  if (error) throw error;
  const d = (data ?? {}) as Partial<PlaceDetail>;
  return {
    found: !!d.found,
    place: d.place,
    my_support: d.my_support,
    impact: d.impact,
    upcoming_meetups: d.upcoming_meetups ?? [],
    upcoming_meetups_total: d.upcoming_meetups_total ?? 0,
    can_host_here: !!d.can_host_here,
  };
}

export const FRESHNESS_LABEL: Record<VerificationFreshness, string> = {
  recent: "Verified recently",
  due_soon: "Verification due soon",
  refresh_pending: "Verification refresh pending",
};

export const CLASSIFICATION_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian Friendly",
  vegan_options: "Vegan Options",
};

export const PLACE_CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

/** Member-safe date, no times. */
export function formatVisitDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatMeetupWhen(date: string, startTime: string): string {
  const d = new Date(`${date}T${startTime}`);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

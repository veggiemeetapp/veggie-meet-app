import { supabase } from "@/integrations/supabase/client";
import {
  fetchAttendingMeetups,
  fetchHostedMeetups,
  fetchPublishedCommunityPlaces,
} from "@/lib/backend";
import { todayISO } from "@/lib/todayDate";
import type { CommunityPlace, Meetup } from "@/types";

export type Dietary = "vegan" | "vegetarian" | "curious";

export interface VeggieProfile {
  id: string;
  displayName: string;
  firstName: string;
  age?: number;
  avatarUrl: string | null;
  bio: string;
  city: string | null;
  interests: string[];
  isActiveHost: boolean;
  hostedCount: number;
  attendedCount: number;
  memberSince: string | null;
  dietary: Dietary;
}

export interface VeggieProfileBundle {
  profile: VeggieProfile;
  upcoming: Meetup[];
  favoritePlaces: CommunityPlace[];
  metrics: {
    hosted: number;
    joined: number;
    placesSupported: number;
    verifiedConnections: number;
  };
  mutualConnections: {
    profileId: string;
    displayName: string;
    avatarUrl: string | null;
  }[];
}

function deriveDietary(interests: string[]): Dietary {
  const set = new Set(interests.map((i) => i.toLowerCase()));
  if (set.has("vegan")) return "vegan";
  if (set.has("vegetarian")) return "vegetarian";
  return "curious";
}

export const DIETARY_LABEL: Record<Dietary, string> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  curious: "Plant Curious",
};


export async function fetchVeggieProfileBundle(
  targetProfileId: string,
  currentProfileId?: string,
): Promise<VeggieProfileBundle | null> {
  // Server-side availability projection: if either side has blocked the other
  // (or profile missing), return null so caller renders the neutral unavailable state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: avail } = await (supabase.rpc as any)(
    "get_veggie_profile_availability",
    { _target_profile_id: targetProfileId },
  );
  if (avail && avail.available === false) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select(
      "id, display_name, bio, avatar_url, current_city, interests, home_city_id, is_active_host, created_at, pronouns, dietary_identity, cities:home_city_id(name)",
    )
    .eq("id", targetProfileId)
    .maybeSingle();
  if (!prof) return null;

  const interests: string[] = prof.interests ?? [];
  const displayName: string = prof.display_name ?? "Veggie";
  const firstName = displayName.split(/\s+/)[0] ?? displayName;

  const [hosted, attending, checkinsRes, connSummaryRes] = await Promise.all([
    fetchHostedMeetups(targetProfileId, todayISO()),
    fetchAttendingMeetups(targetProfileId, todayISO()),
    supabase
      .from("community_place_visits")
      .select("community_place_id, visited_at")
      .eq("profile_id", targetProfileId)
      .eq("verification_status", "verified")
      .order("visited_at", { ascending: false }),
    // Bounded server-side projection: verified-connection count + shared
    // mutuals only. The global social graph is never readable by clients.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.rpc as any)("get_profile_connection_summary", {
      _target_profile_id: targetProfileId,
    }),
  ]);
  const connSummary = (connSummaryRes?.data ?? null) as {
    verified_connections?: number;
    mutual_connections?: { profileId: string; displayName: string; avatarUrl: string | null }[];
  } | null;


  // Historical counts (any date)
  const { count: hostedTotal } = await supabase
    .from("meetups")
    .select("id", { count: "exact", head: true })
    .eq("host_id", targetProfileId);
  const { count: joinedTotal } = await supabase
    .from("attendance")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", targetProfileId)
    .neq("status", "cancelled");

  // Favorite places: top places by check-in count, resolved against published
  // Community Places (WO-095: this used to resolve names from the mock-data
  // fixture, so a real check-in could render a fixture place name).
  const counts = new Map<string, number>();
  for (const r of checkinsRes.data ?? []) {
    const id = (r as any).community_place_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const topPlaceIds = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => id);
  let favoritePlaces: CommunityPlace[] = [];
  if (topPlaceIds.length > 0) {
    const published = await fetchPublishedCommunityPlaces(null);
    favoritePlaces = topPlaceIds
      .map((id) => published.find((p) => p.id === id))
      .filter((p): p is CommunityPlace => !!p);
  }

  const uniquePlaces = new Set((checkinsRes.data ?? []).map((c: any) => c.community_place_id));

  // Mutual connections (server-computed, bounded to 8)
  let mutualConnections: VeggieProfileBundle["mutualConnections"] = [];
  if (currentProfileId && currentProfileId !== targetProfileId) {
    mutualConnections = (connSummary?.mutual_connections ?? []).map((m) => ({
      profileId: m.profileId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl ?? null,
    }));
  }


  // Combine upcoming: hosted + attending, sorted
  const upcoming = [...hosted, ...attending]
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
    .sort((a, b) =>
      a.date === b.date
        ? a.startTime.localeCompare(b.startTime)
        : a.date.localeCompare(b.date),
    )
    .slice(0, 6);

  return {
    profile: {
      id: prof.id,
      displayName,
      firstName,
      avatarUrl: prof.avatar_url ?? null,
      bio: prof.bio ?? "",
      city: (prof as any).cities?.name ?? prof.current_city ?? null,
      interests,
      isActiveHost: prof.is_active_host ?? false,
      hostedCount: hostedTotal ?? 0,
      attendedCount: joinedTotal ?? 0,
      memberSince: (prof as any).created_at ?? null,
      dietary: deriveDietary(interests),
    },
    upcoming,
    favoritePlaces,
    metrics: {
      hosted: hostedTotal ?? 0,
      joined: joinedTotal ?? 0,
      placesSupported: uniquePlaces.size,
      verifiedConnections: connSummary?.verified_connections ?? 0,
    },
    mutualConnections,
  };
}

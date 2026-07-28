import { supabase } from "@/integrations/supabase/client";
import { fetchAttendingMeetups, fetchHostedMeetups } from "@/lib/backend";
import { TODAY_ISO, communityPlaces } from "@/lib/mock-data";
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

async function fetchConnectedIds(profileId: string): Promise<string[]> {
  const { data } = await supabase
    .from("friendships")
    .select("profile_a_id, profile_b_id, status")
    .or(`profile_a_id.eq.${profileId},profile_b_id.eq.${profileId}`)
    .in("status", ["connected", "verified"]);
  return (data ?? []).map((r: any) =>
    r.profile_a_id === profileId ? r.profile_b_id : r.profile_a_id,
  );
}

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
      "id, display_name, bio, avatar_url, current_city, interests, home_city_id, is_active_host, meetups_hosted_count, meetups_attended_count, veggies_met_count, created_at, pronouns, dietary_identity, cities:home_city_id(name)",
    )
    .eq("id", targetProfileId)
    .maybeSingle();
  if (!prof) return null;

  const interests: string[] = prof.interests ?? [];
  const displayName: string = prof.display_name ?? "Veggie";
  const firstName = displayName.split(/\s+/)[0] ?? displayName;

  const [hosted, attending, checkinsRes, verifiedRes, targetConnected] =
    await Promise.all([
      fetchHostedMeetups(targetProfileId, TODAY_ISO),
      fetchAttendingMeetups(targetProfileId, TODAY_ISO),
      supabase
        .from("place_check_ins")
        .select("community_place_id, checked_in_on")
        .eq("profile_id", targetProfileId)
        .order("checked_in_on", { ascending: false }),
      supabase
        .from("friendships")
        .select("id, status")
        .or(
          `profile_a_id.eq.${targetProfileId},profile_b_id.eq.${targetProfileId}`,
        )
        .eq("status", "verified"),
      fetchConnectedIds(targetProfileId),
    ]);

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

  // Favorite places: top places by check-in count
  const counts = new Map<string, number>();
  for (const r of checkinsRes.data ?? []) {
    const id = (r as any).community_place_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const favoritePlaces = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => communityPlaces.find((p) => p.id === id))
    .filter((p): p is CommunityPlace => !!p);

  const uniquePlaces = new Set((checkinsRes.data ?? []).map((c: any) => c.community_place_id));

  // Mutual connections
  let mutualConnections: VeggieProfileBundle["mutualConnections"] = [];
  if (currentProfileId && currentProfileId !== targetProfileId) {
    const myConnected = await fetchConnectedIds(currentProfileId);
    const mutualIds = myConnected.filter((id) => targetConnected.includes(id));
    if (mutualIds.length > 0) {
      const { data: mprofs } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", mutualIds.slice(0, 8));
      mutualConnections = (mprofs ?? []).map((p: any) => ({
        profileId: p.id,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
      }));
    }
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
      verifiedConnections: (verifiedRes.data ?? []).length,
    },
    mutualConnections,
  };
}

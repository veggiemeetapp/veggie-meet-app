import { supabase } from "@/integrations/supabase/client";
import { communityPlaces } from "@/lib/mock-data";

export type ImpactEventType = "veggie_met" | "place_supported" | "meetup_hosted";

export interface ImpactEvent {
  id: string;
  type: ImpactEventType;
  label: string; // e.g. "Met Sarah"
  date: string; // ISO date (YYYY-MM-DD)
}

export interface CommunityImpact {
  veggiesMet: number;
  placesSupported: number;
  timeline: ImpactEvent[];
}

function placeName(id: string) {
  return communityPlaces.find((p) => p.id === id)?.name ?? "a Community Place";
}

export async function fetchCommunityImpact(profileId: string): Promise<CommunityImpact> {
  const [friendsRes, checkinsRes, hostedRes] = await Promise.all([
    supabase
      .from("friendships")
      .select("id, profile_a_id, profile_b_id, friends_since, status")
      .or(`profile_a_id.eq.${profileId},profile_b_id.eq.${profileId}`)
      .eq("status", "verified"),
    supabase
      .from("place_check_ins")
      .select("id, community_place_id, checked_in_on")
      .eq("profile_id", profileId)
      .order("checked_in_on", { ascending: false }),
    supabase
      .from("meetups")
      .select("id, title, date")
      .eq("host_id", profileId)
      .order("date", { ascending: false }),
  ]);

  const friendships = friendsRes.data ?? [];
  const checkins = checkinsRes.data ?? [];
  const hosted = hostedRes.data ?? [];

  // Resolve names of the "other" veggie for each friendship
  const otherIds = Array.from(
    new Set(
      friendships.map((f: any) =>
        f.profile_a_id === profileId ? f.profile_b_id : f.profile_a_id,
      ),
    ),
  );
  let nameById = new Map<string, string>();
  if (otherIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", otherIds);
    (profs ?? []).forEach((p: any) => nameById.set(p.id, p.display_name));
  }

  const veggieEvents: ImpactEvent[] = friendships.map((f: any) => {
    const otherId = f.profile_a_id === profileId ? f.profile_b_id : f.profile_a_id;
    const name = nameById.get(otherId) ?? "a Veggie";
    return {
      id: `f_${f.id}`,
      type: "veggie_met",
      label: `Met ${name}`,
      date: f.friends_since,
    };
  });

  const placeEvents: ImpactEvent[] = checkins.map((c: any) => ({
    id: `p_${c.id}`,
    type: "place_supported",
    label: `Supported ${placeName(c.community_place_id)}`,
    date: c.checked_in_on,
  }));

  const hostEvents: ImpactEvent[] = hosted.map((m: any) => ({
    id: `h_${m.id}`,
    type: "meetup_hosted",
    label: `Hosted ${m.title}`,
    date: m.date,
  }));

  const timeline = [...veggieEvents, ...placeEvents, ...hostEvents].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  const uniquePlaces = new Set(checkins.map((c: any) => c.community_place_id));

  return {
    veggiesMet: friendships.length,
    placesSupported: uniquePlaces.size,
    timeline,
  };
}

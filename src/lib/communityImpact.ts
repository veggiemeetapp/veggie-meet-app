import { supabase } from "@/integrations/supabase/client";

export type ImpactActivityType =
  | "verified_connection"
  | "place_supported"
  | "meetup_hosted";

export interface ImpactActivity {
  id: string;
  activity_type: ImpactActivityType;
  occurred_at: string | null;
  subject_profile_id: string | null;
  subject_meetup_id: string | null;
  subject_place_id: string | null;
}

export interface CommunityImpactOverview {
  veggies_met: number;
  community_places_supported: number;
  meetups_hosted: number;
  recent_activity: ImpactActivity[];
  last_updated_at: string | null;
}

export interface ImpactHistoryPage {
  items: ImpactActivity[];
  next_cursor: string | null;
  next_cursor_id: string | null;
  has_more: boolean;
}

export interface PublicImpact {
  available: boolean;
  veggies_met?: number;
  community_places_supported?: number;
  meetups_hosted?: number;
}

export interface ImpactSubject {
  profiles: Record<string, { id: string; display_name: string; avatar_url: string | null }>;
  places: Record<string, { id: string; name: string; cover_image_url: string | null; address: string | null }>;
  meetups: Record<
    string,
    {
      id: string;
      title: string;
      date: string;
      cover_image_url: string | null;
      community_place_id: string | null;
      custom_location_name: string | null;
      host_id: string;
    }
  >;
  blockedPeers: Set<string>;
}

export async function fetchMyCommunityImpact(): Promise<CommunityImpactOverview> {
  const { data, error } = await (supabase.rpc as any)("get_my_community_impact");
  if (error) throw error;
  return data as CommunityImpactOverview;
}

export async function fetchMyImpactHistory(params: {
  cursor?: string | null;
  cursorId?: string | null;
  limit?: number;
  type?: ImpactActivityType | null;
}): Promise<ImpactHistoryPage> {
  const { data, error } = await (supabase.rpc as any)("get_my_impact_history", {
    _cursor: params.cursor ?? null,
    _cursor_id: params.cursorId ?? null,
    _limit: params.limit ?? 20,
    _type: params.type ?? null,
  });
  if (error) throw error;
  return data as ImpactHistoryPage;
}

export async function fetchPublicCommunityImpact(
  profileId: string,
): Promise<PublicImpact> {
  const { data, error } = await (supabase.rpc as any)("get_public_community_impact", {
    _profile_id: profileId,
  });
  if (error) throw error;
  return data as PublicImpact;
}

/** Hydrate referenced subjects (profiles/places/meetups) for a list of activities. */
export async function hydrateSubjects(
  activities: ImpactActivity[],
  meProfileId: string,
): Promise<ImpactSubject> {
  const profileIds = new Set<string>();
  const meetupIds = new Set<string>();
  const placeIds = new Set<string>();
  for (const a of activities) {
    if (a.subject_profile_id) profileIds.add(a.subject_profile_id);
    if (a.subject_meetup_id) meetupIds.add(a.subject_meetup_id);
    if (a.subject_place_id) placeIds.add(a.subject_place_id);
  }

  const [profRes, meetRes, placeRes, blockRes] = await Promise.all([
    profileIds.size
      ? supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", Array.from(profileIds))
      : Promise.resolve({ data: [] as any[] }),
    meetupIds.size
      ? supabase
          .from("meetups")
          .select(
            "id, title, date, cover_image_url, community_place_id, custom_location_name, host_id",
          )
          .in("id", Array.from(meetupIds))
      : Promise.resolve({ data: [] as any[] }),
    placeIds.size
      ? supabase
          .from("community_places")
          .select("id, name, cover_image_url, address")
          .in("id", Array.from(placeIds))
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("user_blocks")
      .select("blocker_profile_id, blocked_profile_id")
      .or(
        `blocker_profile_id.eq.${meProfileId},blocked_profile_id.eq.${meProfileId}`,
      ),
  ]);

  const profiles: ImpactSubject["profiles"] = {};
  (profRes.data ?? []).forEach((p: any) => {
    profiles[p.id] = { id: p.id, display_name: p.display_name, avatar_url: p.avatar_url };
  });
  const places: ImpactSubject["places"] = {};
  (placeRes.data ?? []).forEach((p: any) => {
    places[p.id] = {
      id: p.id,
      name: p.name,
      cover_image_url: p.cover_image_url,
      address: p.address,
    };
  });
  const meetups: ImpactSubject["meetups"] = {};
  (meetRes.data ?? []).forEach((m: any) => {
    meetups[m.id] = m;
  });
  const blockedPeers = new Set<string>();
  (blockRes.data ?? []).forEach((b: any) => {
    if (b.blocker_profile_id === meProfileId)
      blockedPeers.add(b.blocked_profile_id);
    else if (b.blocked_profile_id === meProfileId)
      blockedPeers.add(b.blocker_profile_id);
  });

  return { profiles, places, meetups, blockedPeers };
}

export function firstName(displayName: string | undefined | null): string {
  if (!displayName) return "a Veggie";
  return displayName.split(/\s+/)[0] ?? displayName;
}

export function formatOccurredAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

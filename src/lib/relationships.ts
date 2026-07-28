import { supabase } from "@/integrations/supabase/client";
import { TODAY_ISO } from "@/lib/mock-data";


export type RelationshipStatus =
  | "pending"
  | "connected"
  | "verified"
  | "removed"
  | "blocked";

export interface NetworkPerson {
  profileId: string;
  displayName: string;
  city: string | null;
  cityId: string | null;
  bio: string | null;
  avatarUrl: string | null;
  interests: string[];
}

export interface Relationship {
  id: string;
  status: RelationshipStatus;
  requesterId: string | null;
  other: NetworkPerson;
}

interface FriendshipRow {
  id: string;
  profile_a_id: string;
  profile_b_id: string;
  requester_id: string | null;
  status: RelationshipStatus;
}

interface ProfileLite {
  id: string;
  display_name: string;
  home_city_id: string | null;
  cities?: { name: string | null } | null;
  bio: string | null;
  avatar_url: string | null;
  interests: string[] | null;
}

function toPerson(p: ProfileLite): NetworkPerson {
  return {
    profileId: p.id,
    displayName: p.display_name,
    city: p.cities?.name ?? null,
    cityId: p.home_city_id ?? null,
    bio: p.bio,
    avatarUrl: p.avatar_url,
    interests: p.interests ?? [],
  };
}

async function hydrate(
  rows: FriendshipRow[],
  meId: string,
): Promise<Relationship[]> {
  if (rows.length === 0) return [];
  const otherIds = Array.from(
    new Set(rows.map((r) => (r.profile_a_id === meId ? r.profile_b_id : r.profile_a_id))),
  );
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name, home_city_id, cities:home_city_id(name), bio, avatar_url, interests")
    .in("id", otherIds);
  const byId = new Map<string, ProfileLite>();
  (profs ?? []).forEach((p) => byId.set(p.id, p as unknown as ProfileLite));
  return rows.map((r) => {
    const otherId = r.profile_a_id === meId ? r.profile_b_id : r.profile_a_id;
    const other: ProfileLite = byId.get(otherId) ?? {
      id: otherId,
      display_name: "Unknown Veggie",
      home_city_id: null,
      cities: null,
      bio: null,
      avatar_url: null,
      interests: [],
    };
    return {
      id: r.id,
      status: r.status,
      requesterId: r.requester_id,
      other: toPerson(other),
    };
  });
}

/** All rows the current user participates in. */
async function fetchAll(meId: string): Promise<FriendshipRow[]> {
  const { data, error } = await supabase
    .from("friendships")
    .select("id, profile_a_id, profile_b_id, requester_id, status")
    .or(`profile_a_id.eq.${meId},profile_b_id.eq.${meId}`);
  if (error) throw error;
  return (data ?? []) as FriendshipRow[];
}

export async function fetchNetwork(meId: string) {
  const rows = await fetchAll(meId);
  // Hide blocked pairs from active views. Historical rows are preserved in DB;
  // this only affects what the current user sees on Network / Requests / Meet Next.
  const { data: blockRows } = await supabase
    .from("user_blocks")
    .select("blocker_profile_id, blocked_profile_id")
    .or(`blocker_profile_id.eq.${meId},blocked_profile_id.eq.${meId}`);
  const blockedOthers = new Set<string>();
  (blockRows ?? []).forEach((b) => {
    if (b.blocker_profile_id === meId) blockedOthers.add(b.blocked_profile_id as string);
    if (b.blocked_profile_id === meId) blockedOthers.add(b.blocker_profile_id as string);
  });
  const notBlocked = (r: FriendshipRow) => {
    const other = r.profile_a_id === meId ? r.profile_b_id : r.profile_a_id;
    return !blockedOthers.has(other);
  };
  const active = rows.filter(
    (r) => (r.status === "connected" || r.status === "verified") && notBlocked(r),
  );
  const incoming = rows.filter(
    (r) =>
      r.status === "pending" &&
      r.requester_id &&
      r.requester_id !== meId &&
      notBlocked(r),
  );
  const outgoing = rows.filter(
    (r) => r.status === "pending" && r.requester_id === meId && notBlocked(r),
  );
  const [all, inc, out] = await Promise.all([
    hydrate(active, meId),
    hydrate(incoming, meId),
    hydrate(outgoing, meId),
  ]);
  const verified = all.filter((r) => r.status === "verified");
  return {
    all,
    verified,
    incoming: inc,
    outgoing: out,
    counts: {
      connections: all.length,
      verified: verified.length,
      incoming: inc.length,
      outgoing: out.length,
    },
  };
}

export async function fetchRelationshipWith(
  meId: string,
  otherId: string,
): Promise<Relationship | null> {
  const [lo, hi] = meId < otherId ? [meId, otherId] : [otherId, meId];
  const { data } = await supabase
    .from("friendships")
    .select("id, profile_a_id, profile_b_id, requester_id, status")
    .eq("profile_a_id", lo)
    .eq("profile_b_id", hi)
    .maybeSingle();
  if (!data) return null;
  const [rel] = await hydrate([data as FriendshipRow], meId);
  return rel ?? null;
}

export async function fetchRelationshipById(
  meId: string,
  friendshipId: string,
): Promise<Relationship | null> {
  const { data } = await supabase
    .from("friendships")
    .select("id, profile_a_id, profile_b_id, requester_id, status")
    .eq("id", friendshipId)
    .maybeSingle();
  if (!data) return null;
  const [rel] = await hydrate([data as FriendshipRow], meId);
  return rel ?? null;
}

/**
 * Send a new connection request from `meId` to `otherId`. Idempotent:
 * - No-op if a row already exists in an active/pending state.
 * - Re-opens a 'removed' row as a fresh pending request.
 */
export async function sendConnectionRequest(meId: string, otherId: string) {
  if (meId === otherId) throw new Error("You can't connect with yourself.");
  const existing = await fetchRelationshipWith(meId, otherId);
  if (existing) {
    if (existing.status === "removed") {
      const { error } = await supabase
        .from("friendships")
        .update({ status: "pending", requester_id: meId })
        .eq("id", existing.id);
      if (error) throw error;
      return { ok: true, state: "requested" as const };
    }
    if (existing.status === "pending") {
      // If the other person already sent us a request, auto-accept.
      if (existing.requesterId && existing.requesterId !== meId) {
        await acceptRequest(existing.id);
        return { ok: true, state: "connected" as const };
      }
      return { ok: true, state: "already_pending" as const };
    }
    return { ok: true, state: "already_connected" as const };
  }
  const { error } = await supabase.from("friendships").insert({
    profile_a_id: meId,
    profile_b_id: otherId,
    requester_id: meId,
    status: "pending",
    friends_since: new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  // First meaningful action is recorded server-side via trg_activation_friendship.
  // Notification-worthy action → contextual (one-shot) permission prompt.
  try {
    const { maybePromptForNotifications } = await import("@/lib/notificationPrompt");
    maybePromptForNotifications();
  } catch { /* non-blocking */ }
  return { ok: true, state: "requested" as const };
}

export async function acceptRequest(friendshipId: string) {
  const { error } = await supabase
    .from("friendships")
    .update({ status: "connected" })
    .eq("id", friendshipId);
  if (error) throw error;
}

export async function declineRequest(friendshipId: string) {
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  if (error) throw error;
}

export async function removeConnection(friendshipId: string) {
  const { error } = await supabase
    .from("friendships")
    .update({ status: "removed" })
    .eq("id", friendshipId);
  if (error) throw error;
}

/** Sender-initiated cancellation of an outgoing pending request. Deletes the row. */
export async function cancelRequest(friendshipId: string) {
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  if (error) throw error;
}

/* --------------------------- Meet Next --------------------------- */

export interface MeetNextCandidate {
  profileId: string;
  displayName: string;
  firstName: string;
  city: string | null;
  avatarUrl: string | null;
  interests: string[];
  sharedInterests: string[];
  isActiveHost: boolean;
  reason: string;
}

interface CandidateProfileRow {
  id: string;
  display_name: string;
  home_city_id: string | null;
  cities?: { name: string | null } | null;
  avatar_url: string | null;
  interests: string[] | null;
  is_active_host: boolean | null;
}

/**
 * Recommend up to `limit` real people the user is not already related to.
 * Every returned candidate has a concrete, data-backed reason.
 *
 * `meCityId` is the viewer's Home City id. Same-city matches use canonical
 * `home_city_id`; free-text `current_city` is never consulted here.
 */
export async function fetchMeetNext(
  meProfileId: string,
  meCityId: string | null,
  meInterests: string[],
  limit = 6,
): Promise<MeetNextCandidate[]> {
  // 1. Exclude everyone the user already has any friendship row with.
  const { data: fRows } = await supabase
    .from("friendships")
    .select("profile_a_id, profile_b_id, status")
    .or(`profile_a_id.eq.${meProfileId},profile_b_id.eq.${meProfileId}`);
  const excluded = new Set<string>([meProfileId]);
  (fRows ?? []).forEach((r) => {
    excluded.add(r.profile_a_id);
    excluded.add(r.profile_b_id);
  });
  const { data: blockRows } = await supabase
    .from("user_blocks")
    .select("blocker_profile_id, blocked_profile_id")
    .or(`blocker_profile_id.eq.${meProfileId},blocked_profile_id.eq.${meProfileId}`);
  (blockRows ?? []).forEach((b) => {
    excluded.add(b.blocker_profile_id as string);
    excluded.add(b.blocked_profile_id as string);
  });

  // 2. Attendance context: profiles who share an upcoming meetup with me.
  const { data: myAtt } = await supabase
    .from("attendance")
    .select("meetup_id, meetups!inner(id, title, date)")
    .eq("profile_id", meProfileId)
    .neq("status", "cancelled")
    .gte("meetups.date", TODAY_ISO);
  type AttRow = { meetup_id: string; meetups: { title: string } };
  const myMeetups = (myAtt ?? []) as unknown as AttRow[];
  const sharedMeetup = new Map<string, string>();
  if (myMeetups.length > 0) {
    const ids = myMeetups.map((r) => r.meetup_id);
    const titleById = new Map(myMeetups.map((r) => [r.meetup_id, r.meetups.title]));
    const { data: others } = await supabase
      .from("attendance")
      .select("profile_id, meetup_id")
      .in("meetup_id", ids)
      .neq("status", "cancelled");
    (others ?? []).forEach((r) => {
      if (r.profile_id === meProfileId) return;
      const title = titleById.get(r.meetup_id);
      if (title && !sharedMeetup.has(r.profile_id)) {
        sharedMeetup.set(r.profile_id, title);
      }
    });
  }

  // 3. Candidate profiles — canonical `home_city_id`, joined city name for display.
  const { data: profs } = await supabase
    .from("profiles")
    .select(
      "id, display_name, home_city_id, cities:home_city_id(name), avatar_url, interests, is_active_host",
    )
    .neq("id", meProfileId)
    .limit(80);

  const meInterestSet = new Set(meInterests.map((i) => i.toLowerCase()));

  const scored = ((profs ?? []) as unknown as CandidateProfileRow[])
    .filter((p) => !excluded.has(p.id))
    .map((p) => {
      const interests = p.interests ?? [];
      const cityName = p.cities?.name ?? null;
      const sameCity = !!meCityId && p.home_city_id === meCityId;
      const sharedInterests = interests.filter((i) =>
        meInterestSet.has(i.toLowerCase()),
      );
      let reason: string | null = null;
      let score = 0;

      if (sharedMeetup.has(p.id)) {
        reason = `Attending ${sharedMeetup.get(p.id)}`;
        score = 100;
      } else if (sharedInterests.length >= 2) {
        reason = `${sharedInterests.length} shared interests`;
        score = 60 + sharedInterests.length;
      } else if (sameCity && p.is_active_host && cityName) {
        reason = `Active Host in ${cityName}`;
        score = 50;
      } else if (sameCity && cityName) {
        reason = `Also in ${cityName}`;
        score = 30;
      } else if (sharedInterests.length === 1) {
        reason = `Also interested in ${sharedInterests[0]}`;
        score = 15;
      }

      if (!reason) return null;
      const displayName = p.display_name ?? "Veggie";
      return {
        profileId: p.id,
        displayName,
        firstName: displayName.split(/\s+/)[0] ?? displayName,
        city: cityName,
        avatarUrl: p.avatar_url,
        interests,
        sharedInterests,
        isActiveHost: !!p.is_active_host,
        reason,
        score,
      };
    })
    .filter((x): x is MeetNextCandidate & { score: number } => !!x)
    .sort((a, b) => b.score - a.score);

  // Deduplicate by unique profile ID — keep the highest-scoring (strongest reason) entry.
  const seen = new Set<string>();
  const unique: MeetNextCandidate[] = [];
  for (const c of scored) {
    if (seen.has(c.profileId)) continue;
    seen.add(c.profileId);
    const { score: _s, ...rest } = c;
    unique.push(rest);
    if (unique.length >= limit) break;
  }

  return unique;
}


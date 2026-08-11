import { supabase } from "@/integrations/supabase/client";

import { fetchSuppressedProfileIds } from "@/lib/safety";


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

/**
 * Peer profile ids the viewer has an in-person Verified Connection with.
 * Reads the append-only `verified_meetup_connections` table (SELECT-only for
 * members; all writes go through `verify_meetup_connection`).
 */
async function fetchVerifiedPeerIds(meId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("verified_meetup_connections")
    .select("profile_a_id, profile_b_id")
    .or(`profile_a_id.eq.${meId},profile_b_id.eq.${meId}`);
  const peers = new Set<string>();
  (data ?? []).forEach((v) => {
    peers.add(v.profile_a_id === meId ? (v.profile_b_id as string) : (v.profile_a_id as string));
  });
  return peers;
}

export async function fetchNetwork(meId: string) {
  const rows = await fetchAll(meId);
  // Hide blocked pairs from active views, in BOTH directions. `user_blocks`
  // rows are only visible to the blocker, so the suppression list comes from a
  // server-side helper that never reveals which side placed the block.
  const blockedOthers = await fetchSuppressedProfileIds();
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
  const [all, inc, out, verifiedPeers] = await Promise.all([
    hydrate(active, meId),
    hydrate(incoming, meId),
    hydrate(outgoing, meId),
    fetchVerifiedPeerIds(meId),
  ]);
  // WO-067 — "Verified / Met in person" is derived from the append-only
  // verified_meetup_connections table (server-only writes), never from the
  // mutable friendships.status field. This keeps the Network badge consistent
  // with Community Impact "Veggies Met".
  all.forEach((r) => {
    if (verifiedPeers.has(r.other.profileId)) r.status = "verified";
  });
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
 * WO-067 — every connection state transition is server-authoritative.
 * Members hold no INSERT/UPDATE/DELETE privilege on `friendships`; each
 * transition runs through a validated SECURITY DEFINER RPC that derives the
 * actor from auth and enforces blocks, self-targeting, duplicates, and role
 * (only the recipient can accept, only the sender can cancel).
 */

type RequestState =
  | "requested"
  | "already_pending"
  | "already_connected"
  | "connected"
  | "unavailable"
  | "invalid";

function rpcState(data: unknown): string {
  return (data as { state?: string } | null)?.state ?? "invalid";
}

/**
 * Send a connection request from the authenticated member to `otherId`.
 * Idempotent; re-opens a 'removed' pair, and accepts a pending reverse request.
 */
export async function sendConnectionRequest(meId: string, otherId: string) {
  if (meId === otherId) throw new Error("You can't connect with yourself.");
  const { data, error } = await (supabase.rpc as any)("send_connection_request", {
    _target_profile_id: otherId,
  });
  if (error) throw error;
  const state = rpcState(data);
  if (state === "unavailable") throw new Error("This connection isn't available.");
  if (state === "invalid") throw new Error("That Veggie couldn't be found.");
  // First meaningful action is recorded server-side via trg_activation_friendship.
  // Notification-worthy action → contextual (one-shot) permission prompt.
  try {
    const { maybePromptForNotifications } = await import("@/lib/notificationPrompt");
    maybePromptForNotifications();
  } catch { /* non-blocking */ }
  return { ok: true, state: state as RequestState };
}

export async function acceptRequest(friendshipId: string) {
  const { data, error } = await (supabase.rpc as any)("accept_connection_request", {
    _friendship_id: friendshipId,
  });
  if (error) throw error;
  const state = rpcState(data);
  if (state === "connected" || state === "already_connected") return;
  if (state === "unavailable") throw new Error("This connection isn't available.");
  throw new Error("That request is no longer available.");
}

export async function declineRequest(friendshipId: string) {
  const { data, error } = await (supabase.rpc as any)("decline_connection_request", {
    _friendship_id: friendshipId,
  });
  if (error) throw error;
  if (rpcState(data) !== "declined") {
    throw new Error("That request is no longer available.");
  }
}

export async function removeConnection(friendshipId: string) {
  const { data, error } = await (supabase.rpc as any)("remove_connection", {
    _friendship_id: friendshipId,
  });
  if (error) throw error;
  if (rpcState(data) !== "removed") {
    throw new Error("That connection is no longer available.");
  }
}

/** Sender-initiated cancellation of an outgoing pending request. */
export async function cancelRequest(friendshipId: string) {
  const { data, error } = await (supabase.rpc as any)("cancel_connection_request", {
    _friendship_id: friendshipId,
  });
  if (error) throw error;
  if (rpcState(data) !== "cancelled") {
    throw new Error("That request is no longer available.");
  }
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

interface MeetNextRow {
  profile_id: string;
  display_name: string | null;
  avatar_url: string | null;
  city_name: string | null;
  interests: string[] | null;
  shared_interests: string[] | null;
  dietary_identity: string | null;
  is_active_host: boolean | null;
  reason_code: string | null;
  reason_label: string | null;
}

/**
 * WO-075 — Meet Next is fully server-authoritative.
 *
 * `get_meet_next_candidates` derives the viewer from `auth.uid()` and applies the
 * canonical discovery eligibility rule (`discovery_eligible_profile_ids`):
 * not self, not deleted, onboarding complete, discovery-visible, not blocked in
 * either direction, and no existing friendship row. Reasons, ranking and the
 * result field set are decided server-side; the client never filters candidates
 * and never receives coordinates or internal scores.
 */
export async function fetchMeetNext(limit = 6): Promise<MeetNextCandidate[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    n: string,
    a?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "get_meet_next_candidates",
    { _limit: limit },
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MeetNextRow[];
  return rows.map((r) => {
    const displayName = r.display_name ?? "Veggie";
    return {
      profileId: r.profile_id,
      displayName,
      firstName: displayName.split(/\s+/)[0] ?? displayName,
      city: r.city_name,
      avatarUrl: r.avatar_url,
      interests: r.interests ?? [],
      sharedInterests: r.shared_interests ?? [],
      isActiveHost: !!r.is_active_host,
      reason: r.reason_label ?? "Suggested for you",
    };
  });
}



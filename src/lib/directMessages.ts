import { supabase } from "@/integrations/supabase/client";

export interface DMConversationRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  last_message_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface DMMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  invitation_id?: string | null;
}

export interface DMOther {
  profileId: string;
  displayName: string;
  firstName: string;
  avatarUrl: string | null;
  city: string | null;
  isVerifiedConnection: boolean;
}

export interface DMInboxItem {
  conversationId: string;
  other: DMOther;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  unreadCount: number;
}

export const MESSAGE_MAX = 2000;

export async function getOrCreateConversation(
  otherProfileId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_dm", {
    _other_profile_id: otherProfileId,
  });
  if (error) throw error;
  return data as string;
}

export async function markConversationRead(conversationId: string) {
  const { error } = await supabase.rpc("mark_dm_read", {
    _conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function sendDirectMessage(
  conversationId: string,
  senderProfileId: string,
  body: string,
): Promise<DMMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message can't be empty");
  if (trimmed.length > MESSAGE_MAX)
    throw new Error(`Messages must be under ${MESSAGE_MAX} characters`);
  const { data, error } = await supabase
    .from("dm_messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderProfileId,
      body: trimmed,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DMMessage;
}

export async function fetchMessages(conversationId: string): Promise<DMMessage[]> {
  const { data, error } = await supabase
    .from("dm_messages")
    .select("id, conversation_id, sender_id, body, created_at, read_at, invitation_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DMMessage[];
}

export async function fetchConversationWithOther(
  conversationId: string,
  meProfileId: string,
): Promise<{ conversation: DMConversationRow; other: DMOther } | null> {
  const { data: conv } = await supabase
    .from("dm_conversations")
    .select("id, user_a_id, user_b_id, last_message_at, updated_at, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;
  const c = conv as DMConversationRow;
  const otherId = c.user_a_id === meProfileId ? c.user_b_id : c.user_a_id;
  const other = await fetchOtherPerson(otherId, meProfileId);
  return { conversation: c, other };
}

async function fetchOtherPerson(
  otherId: string,
  meProfileId: string,
): Promise<DMOther> {
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, current_city")
    .eq("id", otherId)
    .maybeSingle();
  const displayName = (data?.display_name as string) ?? "Veggie";
  // verified connection?
  const [lo, hi] = meProfileId < otherId ? [meProfileId, otherId] : [otherId, meProfileId];
  const { data: fRow } = await supabase
    .from("friendships")
    .select("status")
    .eq("profile_a_id", lo)
    .eq("profile_b_id", hi)
    .maybeSingle();
  return {
    profileId: otherId,
    displayName,
    firstName: displayName.split(/\s+/)[0] ?? displayName,
    avatarUrl: (data?.avatar_url as string | null) ?? null,
    city: (data?.current_city as string | null) ?? null,
    isVerifiedConnection: fRow?.status === "verified",
  };
}

export async function fetchInbox(meProfileId: string): Promise<DMInboxItem[]> {
  const { data: convs, error } = await supabase
    .from("dm_conversations")
    .select("id, user_a_id, user_b_id, last_message_at, updated_at, created_at")
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  // Suppress conversations with blocked pairs in BOTH directions. The blocked
  // party cannot read `user_blocks`, so this uses the server-side helper that
  // never discloses which side placed the block.
  const suppressed = await fetchSuppressedProfileIds();
  const rows = ((convs ?? []) as DMConversationRow[]).filter((r) => {
    const other = r.user_a_id === meProfileId ? r.user_b_id : r.user_a_id;
    return !suppressed.has(other);
  });
  if (rows.length === 0) return [];

  const otherIds = rows.map((r) =>
    r.user_a_id === meProfileId ? r.user_b_id : r.user_a_id,
  );


  const [{ data: profs }, { data: friends }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, current_city")
      .in("id", otherIds),
    supabase
      .from("friendships")
      .select("profile_a_id, profile_b_id, status")
      .or(`profile_a_id.eq.${meProfileId},profile_b_id.eq.${meProfileId}`),
  ]);
  const byId = new Map<string, { display_name: string; avatar_url: string | null; current_city: string | null }>();
  (profs ?? []).forEach((p) =>
    byId.set(p.id as string, {
      display_name: p.display_name as string,
      avatar_url: (p.avatar_url as string | null) ?? null,
      current_city: (p.current_city as string | null) ?? null,
    }),
  );
  const verifiedSet = new Set<string>();
  (friends ?? []).forEach((f) => {
    if (f.status !== "verified") return;
    const other = f.profile_a_id === meProfileId ? f.profile_b_id : f.profile_a_id;
    verifiedSet.add(other as string);
  });

  // Batch-fetch last message + unread count per conversation.
  const items: DMInboxItem[] = await Promise.all(
    rows.map(async (r) => {
      const otherId = r.user_a_id === meProfileId ? r.user_b_id : r.user_a_id;
      const [{ data: last }, { count }] = await Promise.all([
        supabase
          .from("dm_messages")
          .select("body, sender_id, created_at")
          .eq("conversation_id", r.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("dm_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", r.id)
          .neq("sender_id", meProfileId)
          .is("read_at", null),
      ]);
      const p = byId.get(otherId);
      const displayName = p?.display_name ?? "Veggie";
      return {
        conversationId: r.id,
        other: {
          profileId: otherId,
          displayName,
          firstName: displayName.split(/\s+/)[0] ?? displayName,
          avatarUrl: p?.avatar_url ?? null,
          city: p?.current_city ?? null,
          isVerifiedConnection: verifiedSet.has(otherId),
        },
        lastMessageBody: (last?.body as string | undefined) ?? null,
        lastMessageAt: (last?.created_at as string | undefined) ?? r.last_message_at,
        lastSenderId: (last?.sender_id as string | undefined) ?? null,
        unreadCount: count ?? 0,
      };
    }),
  );
  return items;
}

export async function unreadConversationCount(meProfileId: string): Promise<number> {
  const inbox = await fetchInbox(meProfileId);
  return inbox.filter((i) => i.unreadCount > 0).length;
}

/* -------------------- Blocks (read-only helper) --------------------
 * Writing blocks/reports goes through the canonical safety RPCs in
 * `src/lib/safety.ts` (block_profile, submit_profile_report,
 * submit_message_report, submit_safety_report). The helper below is a
 * read-only convenience for gating the DM composer; it uses the same
 * `user_blocks` table under RLS that scopes rows to the blocker.
 */

export async function isBlockedByMe(meProfileId: string, otherProfileId: string) {
  const { data } = await supabase
    .from("user_blocks")
    .select("id")
    .eq("blocker_profile_id", meProfileId)
    .eq("blocked_profile_id", otherProfileId)
    .maybeSingle();
  return !!data;
}

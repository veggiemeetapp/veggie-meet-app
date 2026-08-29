import { supabase } from "@/integrations/supabase/client";
import { normalizeReactions, type MessageReaction } from "@/lib/chatReactions";

export interface DMMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  /** Null once the author deletes the message (member-facing tombstone). */
  body: string | null;
  created_at: string;
  read_at: string | null;
  invitation_id?: string | null;
  /** WO-136: set when the author edited the message; never set on tombstones. */
  edited_at?: string | null;
  deleted_at?: string | null;
  is_deleted?: boolean;
  /** WO-137: aggregate emoji reactions (no reactor identities). */
  reactions?: MessageReaction[];
}


/** WO-136 neutral tombstone copy, shared by the thread and the inbox preview. */
export const MESSAGE_DELETED_LABEL = "Message deleted";

export function isDeletedMessage(m: {
  deleted_at?: string | null;
  is_deleted?: boolean;
}): boolean {
  return !!m.is_deleted || !!m.deleted_at;
}


export interface DMOther {
  profileId: string;
  displayName: string;
  firstName: string;
  avatarUrl: string | null;
  city: string | null;
  isVerifiedConnection: boolean;
}

export interface DMThread {
  conversationId: string;
  other: DMOther;
  messages: DMMessage[];
  hasMore: boolean;
  canSend: boolean;
  isBlocked: boolean;
  isConnected: boolean;
}

export interface DMInboxItem {
  conversationId: string;
  other: DMOther;
  lastMessageBody: string | null;
  /** WO-136: the latest message is a tombstone, so show neutral preview copy. */
  lastMessageIsDeleted: boolean;

  lastMessageAt: string | null;
  lastSenderId: string | null;
  unreadCount: number;
}

export const MESSAGE_MAX = 2000;
/** Bounded initial page — server clamps to 50. */
export const MESSAGE_PAGE_SIZE = 40;

function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] ?? displayName;
}

/**
 * WO-069: the entire DM surface is RPC-only.
 * `authenticated` holds SELECT on dm_conversations / dm_messages (participant
 * RLS + scoped realtime) and NO INSERT/UPDATE/DELETE — every write goes through
 * a SECURITY DEFINER RPC that derives the actor from auth and re-checks
 * connection eligibility plus both-direction blocks.
 */

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
  body: string,
  clientToken?: string | null,
): Promise<DMMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message can't be empty");
  if (trimmed.length > MESSAGE_MAX)
    throw new Error(`Messages must be under ${MESSAGE_MAX} characters`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("send_dm_message", {
    _conversation_id: conversationId,
    _body: trimmed,
    // WO-083: idempotency token so an ambiguous retry cannot duplicate a message.
    _client_token: clientToken ?? null,
  });
  if (error) throw error;
  return data as DMMessage;
}

/**
 * WO-136 — edit own direct message.
 * Ownership, membership, block state and validation are enforced by
 * `edit_dm_message` (SECURITY DEFINER). `authenticated` has no UPDATE grant on
 * `dm_messages`, so this RPC is the only mutation path.
 */
export async function editDirectMessage(
  messageId: string,
  body: string,
): Promise<DMMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message can't be empty");
  if (trimmed.length > MESSAGE_MAX)
    throw new Error(`Messages must be under ${MESSAGE_MAX} characters`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("edit_dm_message", {
    _message_id: messageId,
    _body: trimmed,
  });
  if (error) throw error;
  return data as DMMessage;
}

/**
 * WO-136 — delete own direct message. The row stays in place as a tombstone so
 * ordering, read state and safety references survive; the body is cleared
 * server-side (also for realtime subscribers).
 */
export async function deleteDirectMessage(
  messageId: string,
): Promise<DMMessage> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("delete_dm_message", {
    _message_id: messageId,
  });
  if (error) throw error;
  return data as DMMessage;
}



/**
 * Bounded thread page. Pass the oldest loaded message as the cursor to page
 * backwards; ordering is deterministic on (created_at, id).
 */
export async function fetchThread(
  conversationId: string,
  cursor?: { createdAt: string; id: string } | null,
): Promise<DMThread> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_dm_thread", {
    _conversation_id: conversationId,
    _before_created_at: cursor?.createdAt ?? null,
    _before_id: cursor?.id ?? null,
    _limit: MESSAGE_PAGE_SIZE,
  });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const displayName = (d?.peer?.display_name as string) ?? "Veggie";
  return {
    conversationId: d.conversation_id,
    other: {
      profileId: d.peer.profile_id,
      displayName,
      firstName: firstName(displayName),
      avatarUrl: d.peer.avatar_url ?? null,
      city: d.peer.city ?? null,
      isVerifiedConnection: !!d.peer.is_verified_connection,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: ((d.messages ?? []) as any[]).map((m) => ({
      ...(m as DMMessage),
      reactions: normalizeReactions(m.reactions),
    })),

    hasMore: !!d.has_more,
    canSend: !!d.can_send,
    isBlocked: !!d.is_blocked,
    isConnected: !!d.is_connected,
  };
}

/**
 * Single-RPC inbox: peer identity, last message, and per-recipient unread count
 * in one round trip (no per-row queries). Conversations with a peer involved in
 * a block in either direction are suppressed server-side (WO-068 policy).
 */
export async function fetchInbox(): Promise<DMInboxItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_my_dm_inbox");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const displayName = (r.display_name as string) ?? "Veggie";
    return {
      conversationId: r.conversation_id,
      other: {
        profileId: r.peer_profile_id,
        displayName,
        firstName: firstName(displayName),
        avatarUrl: r.avatar_url ?? null,
        city: r.city ?? null,
        isVerifiedConnection: !!r.is_verified_connection,
      },
      lastMessageBody: r.last_message_body ?? null,
      lastMessageIsDeleted: !!r.last_message_is_deleted,

      lastMessageAt: r.last_message_at ?? null,
      lastSenderId: r.last_sender_id ?? null,
      unreadCount: Number(r.unread_count ?? 0),
    };
  });
}

export async function unreadConversationCount(): Promise<number> {
  const inbox = await fetchInbox();
  return inbox.filter((i) => i.unreadCount > 0).length;
}

/* -------------------- Blocks --------------------
 * Block reads and writes live in `src/lib/safety.ts`. Composer gating uses the
 * pair-aware `isPairBlocked()` RPC so the blocked party is suppressed too, and
 * inbox suppression happens inside `get_my_dm_inbox()`.
 */

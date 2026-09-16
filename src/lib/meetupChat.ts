import { supabase } from "@/integrations/supabase/client";
import { normalizeReactions, type MessageReaction } from "@/lib/chatReactions";


/**
 * WO-070 — Meetup group chat privacy & membership integrity.
 *
 * Group chat is server authoritative: eligibility, posting windows, blocking
 * suppression and pagination all live in SECURITY DEFINER RPCs. The client
 * never writes to `messages` / `chat_participants` directly.
 */

export type ChatPostBlockReason =
  | "not_participant"
  | "cancelled"
  | "completed"
  | "archived"
  | null;

export interface MeetupChatContext {
  can_read: boolean;
  can_post?: boolean;
  post_block_reason?: ChatPostBlockReason;
  chat_id?: string;
  is_host?: boolean;
  participant_count?: number;
  meetup?: {
    id: string;
    title: string;
    date: string;
    start_time: string;
    end_time: string | null;
    status: string;
    location_name: string | null;
    address: string | null;
    timezone: string | null;
  };
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  sender_id: string | null;
  type: "user" | "system";
  created_at: string;
  is_mine: boolean;
  is_suppressed: boolean;
  body: string | null;
  sender_name: string | null;
  sender_avatar_url: string | null;
  /** WO-136 */
  edited_at?: string | null;
  deleted_at?: string | null;
  is_deleted?: boolean;
  /** WO-137: aggregate emoji reactions (no reactor identities). */
  reactions?: MessageReaction[];
}


export interface ChatThreadPage {
  messages: ChatMessage[];
  has_more: boolean;
}

export interface MeetupChatSnapshot {
  context: MeetupChatContext;
  messages: ChatMessage[];
  hasMore: boolean;
}

export const CHAT_PAGE_SIZE = 40;
export const CHAT_MESSAGE_MAX = 2000;
export const MEETUP_CHAT_LOAD_TIMEOUT_MS = 12_000;
export const MEETUP_CHAT_TIMEOUT_MESSAGE = "Meetup chat load timed out";


export async function fetchMeetupChatContext(
  chatId: string,
): Promise<MeetupChatContext> {
  // RPC is newer than the checked-in generated Supabase types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_meetup_chat_context", {
    _chat_id: chatId,
  });
  if (error) throw new Error(error.message);
  return data as MeetupChatContext;
}

export async function fetchMeetupChatThread(
  chatId: string,
  before?: { createdAt: string; id: string } | null,
): Promise<ChatThreadPage> {
  // RPC is newer than the checked-in generated Supabase types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_meetup_chat_thread", {
    _chat_id: chatId,
    _before_created_at: before?.createdAt ?? null,
    _before_id: before?.id ?? null,
    _limit: CHAT_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const page = data as ChatThreadPage;
  return {
    messages: (page?.messages ?? []).map((m) => ({
      ...m,
      reactions: normalizeReactions(m.reactions),
    })),
    has_more: !!page?.has_more,
  };

}

/**
 * Fetch the complete first-paint payload with one bounded client operation.
 * React Query caches this snapshot per chat and member. The timeout keeps a
 * stalled network/RPC request from leaving the route on an endless spinner.
 */
export async function fetchMeetupChatSnapshot(
  chatId: string,
  timeoutMs = MEETUP_CHAT_LOAD_TIMEOUT_MS,
): Promise<MeetupChatSnapshot> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const load = (async () => {
    const context = await fetchMeetupChatContext(chatId);
    if (!context.can_read) return { context, messages: [], hasMore: false };

    const page = await fetchMeetupChatThread(chatId);
    return {
      context,
      messages: page.messages,
      hasMore: page.has_more,
    };
  })();
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(MEETUP_CHAT_TIMEOUT_MESSAGE)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([load, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function sendMeetupChatMessage(
  chatId: string,
  body: string,
  clientToken?: string | null,
): Promise<ChatMessage> {
  // WO-083: `clientToken` makes a send idempotent. If the server committed the
  // message but the response was lost, retrying with the same token returns the
  // original row instead of posting a duplicate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("send_meetup_chat_message", {
    _chat_id: chatId,
    _body: body,
    _client_token: clientToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as ChatMessage;
}

export function postBlockedCopy(reason: ChatPostBlockReason): string | null {
  switch (reason) {
    case "cancelled":
      return "This Meetup was cancelled, so the chat is read-only.";
    case "completed":
      return "This Meetup is complete. The chat is now read-only.";
    case "archived":
      return "This chat closed 24 hours after the Meetup ended.";
    case "not_participant":
      return "This chat is only open to Veggies going to this Meetup.";
    default:
      return null;
  }
}

/**
 * WO-136 — edit own group-chat message. `edit_meetup_chat_message` re-checks the
 * author, chat membership and the posting window server-side; `authenticated`
 * has no UPDATE grant on `messages`.
 */
export async function editMeetupChatMessage(
  messageId: string,
  body: string,
): Promise<ChatMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message can't be empty");
  if (trimmed.length > CHAT_MESSAGE_MAX)
    throw new Error(`Messages must be under ${CHAT_MESSAGE_MAX} characters`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("edit_meetup_chat_message", {
    _message_id: messageId,
    _body: trimmed,
  });
  if (error) throw new Error(error.message);
  return data as ChatMessage;
}

/** WO-136 — delete own group-chat message, leaving a neutral tombstone. */
export async function deleteMeetupChatMessage(
  messageId: string,
): Promise<ChatMessage> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("delete_meetup_chat_message", {
    _message_id: messageId,
  });
  if (error) throw new Error(error.message);
  return data as ChatMessage;
}

/** True when a message is a member-facing tombstone. */
export function isDeletedChatMessage(m: ChatMessage): boolean {
  return !!m.is_deleted || !!m.deleted_at;
}

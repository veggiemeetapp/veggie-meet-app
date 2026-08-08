import { supabase } from "@/integrations/supabase/client";

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
    end_time: string;
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
}

export interface ChatThreadPage {
  messages: ChatMessage[];
  has_more: boolean;
}

export const CHAT_PAGE_SIZE = 40;

export async function fetchMeetupChatContext(
  chatId: string,
): Promise<MeetupChatContext> {
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
  const { data, error } = await (supabase.rpc as any)("get_meetup_chat_thread", {
    _chat_id: chatId,
    _before_created_at: before?.createdAt ?? null,
    _before_id: before?.id ?? null,
    _limit: CHAT_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const page = data as ChatThreadPage;
  return { messages: page?.messages ?? [], has_more: !!page?.has_more };
}

export async function sendMeetupChatMessage(
  chatId: string,
  body: string,
): Promise<ChatMessage> {
  const { data, error } = await (supabase.rpc as any)("send_meetup_chat_message", {
    _chat_id: chatId,
    _body: body,
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

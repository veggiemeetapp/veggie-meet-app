import { supabase } from "@/integrations/supabase/client";

/**
 * WO-137 — emoji reactions for chat messages.
 *
 * Server-authoritative: the approved emoji set, participant authorization,
 * tombstone/system-message rejection and per-member uniqueness all live in
 * `toggle_dm_message_reaction` / `toggle_meetup_message_reaction`
 * (SECURITY DEFINER, pinned search_path, authenticated-only). `authenticated`
 * has no DML on the reaction tables, so these RPCs are the only write path.
 *
 * Reads return aggregate summaries only — never the list of reacting profiles.
 */

export interface MessageReaction {
  emoji: string;
  count: number;
  /** True when the current viewer is one of the reactors. */
  mine: boolean;
}

/** Approved initial reaction set. Must match `is_approved_reaction_emoji()`. */
export const REACTION_EMOJIS = [
  { emoji: "👍", name: "Thumbs up" },
  { emoji: "❤️", name: "Red heart" },
  { emoji: "😂", name: "Face with tears of joy" },
  { emoji: "🎉", name: "Party popper" },
  { emoji: "😮", name: "Surprised face" },
  { emoji: "🙏", name: "Folded hands" },
] as const;

const NAME_BY_EMOJI = new Map<string, string>(
  REACTION_EMOJIS.map((r) => [r.emoji as string, r.name as string]),
);

export function reactionName(emoji: string): string {
  return NAME_BY_EMOJI.get(emoji) ?? "Reaction";
}

export function isApprovedReactionEmoji(emoji: string): boolean {
  return NAME_BY_EMOJI.has(emoji);
}

/** Stable display order: the approved-set order, so pills never reshuffle. */
const ORDER = new Map<string, number>(
  REACTION_EMOJIS.map((r, i) => [r.emoji as string, i]),
);


export function sortReactions(list: MessageReaction[]): MessageReaction[] {
  return [...list].sort(
    (a, b) => (ORDER.get(a.emoji) ?? 99) - (ORDER.get(b.emoji) ?? 99),
  );
}

export function normalizeReactions(input: unknown): MessageReaction[] {
  if (!Array.isArray(input)) return [];
  const out: MessageReaction[] = [];
  for (const raw of input) {
    const r = raw as { emoji?: unknown; count?: unknown; mine?: unknown };
    if (typeof r?.emoji !== "string" || !isApprovedReactionEmoji(r.emoji)) continue;
    const count = Number(r.count ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    out.push({ emoji: r.emoji, count, mine: !!r.mine });
  }
  return sortReactions(out);
}

/**
 * Pure optimistic toggle used before the server answers. Counts can never go
 * negative and zero-count entries are dropped, so rapid taps stay consistent.
 */
export function optimisticToggle(
  current: MessageReaction[] | undefined,
  emoji: string,
): MessageReaction[] {
  const list = current ?? [];
  const existing = list.find((r) => r.emoji === emoji);
  if (!existing) {
    return sortReactions([...list, { emoji, count: 1, mine: true }]);
  }
  if (existing.mine) {
    const count = Math.max(0, existing.count - 1);
    return sortReactions(
      list
        .map((r) => (r.emoji === emoji ? { ...r, count, mine: false } : r))
        .filter((r) => r.count > 0),
    );
  }
  return sortReactions(
    list.map((r) =>
      r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r,
    ),
  );
}

export function reactionPillLabel(r: MessageReaction): string {
  const who = r.mine ? "you reacted" : "you have not reacted";
  return `${reactionName(r.emoji)}, ${r.count} ${r.count === 1 ? "reaction" : "reactions"}, ${who}`;
}

interface ToggleResult {
  message_id: string;
  emoji: string;
  reacted: boolean;
  reactions: MessageReaction[];
}

function parseToggle(data: unknown): ToggleResult {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    message_id: String(d.message_id ?? ""),
    emoji: String(d.emoji ?? ""),
    reacted: !!d.reacted,
    reactions: normalizeReactions(d.reactions),
  };
}

export async function toggleDirectMessageReaction(
  messageId: string,
  emoji: string,
): Promise<ToggleResult> {
  if (!isApprovedReactionEmoji(emoji))
    throw new Error("That reaction is not available");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "toggle_dm_message_reaction",
    { _message_id: messageId, _emoji: emoji },
  );
  if (error) throw error;
  return parseToggle(data);
}

export async function toggleMeetupMessageReaction(
  messageId: string,
  emoji: string,
): Promise<ToggleResult> {
  if (!isApprovedReactionEmoji(emoji))
    throw new Error("That reaction is not available");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "toggle_meetup_message_reaction",
    { _message_id: messageId, _emoji: emoji },
  );
  if (error) throw error;
  return parseToggle(data);
}

export type ReactionMap = Record<string, MessageReaction[]>;

function parseMap(data: unknown): ReactionMap {
  const out: ReactionMap = {};
  const d = (data ?? {}) as Record<string, unknown>;
  for (const [id, list] of Object.entries(d)) out[id] = normalizeReactions(list);
  return out;
}

/** Authoritative refresh for the currently loaded page (realtime convergence). */
export async function fetchDirectMessageReactions(
  conversationId: string,
  messageIds?: string[],
): Promise<ReactionMap> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_dm_message_reactions",
    { _conversation_id: conversationId, _message_ids: messageIds ?? null },
  );
  if (error) throw error;
  return parseMap(data);
}

export async function fetchMeetupMessageReactions(
  chatId: string,
  messageIds?: string[],
): Promise<ReactionMap> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "get_meetup_message_reactions",
    { _chat_id: chatId, _message_ids: messageIds ?? null },
  );
  if (error) throw error;
  return parseMap(data);
}

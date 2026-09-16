const REPLY_PREVIEW_MAX = 120;
const AUTHOR_MAX = 80;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipped(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…".slice(0, Math.max(0, maxLength));
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function safeAuthor(author: string): string {
  return clipped(compact(author) || "Veggie", AUTHOR_MAX);
}

/**
 * Replies stay compatible with the existing message RPC by using a compact,
 * human-readable quote prefix instead of introducing client-only metadata.
 */
export function meetupReplyPrefix(author: string, sourceBody: string): string {
  const preview = clipped(compact(sourceBody), REPLY_PREVIEW_MAX);
  return `↪ Replying to ${safeAuthor(author)}: “${preview}”\n`;
}

export function buildMeetupReplyBody(
  author: string,
  sourceBody: string,
  replyBody: string,
  maxLength: number,
): string {
  const prefix = meetupReplyPrefix(author, sourceBody);
  const reply = replyBody.trim();
  const composed = `${prefix}${reply}`;
  if (composed.length > maxLength) {
    throw new Error(`Messages must be under ${maxLength} characters`);
  }
  return composed;
}

/**
 * A forwarded Meetup message is sent through the existing DM RPC. The source
 * is clipped only when its header would otherwise exceed the DM body limit.
 */
export function buildForwardedMeetupMessage(
  author: string,
  sourceBody: string,
  maxLength: number,
): string {
  const header = `Forwarded from ${safeAuthor(author)} in a Meetup chat:\n`;
  if (header.length >= maxLength) return clipped(header, maxLength);
  const available = Math.max(0, maxLength - header.length);
  return `${header}${clipped(sourceBody.trim(), available)}`;
}

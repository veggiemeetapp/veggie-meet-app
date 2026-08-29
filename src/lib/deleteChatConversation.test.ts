import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-139 source contract regressions for per-member "Delete chat".
 * These assert the invariants the work order requires: RPC-only deletion,
 * separate options control on the Chats card, destructive confirmation, and
 * preserved WO-136/137/138 behavior.
 */
const dmLib = readFileSync("src/lib/directMessages.ts", "utf8");
const chats = readFileSync("src/screens/Chats.tsx", "utf8");
const dm = readFileSync("src/screens/DirectMessage.tsx", "utf8");
const dialog = readFileSync("src/components/chat/DeleteChatDialog.tsx", "utf8");
const meetupChat = readFileSync("src/screens/MeetupChat.tsx", "utf8");

describe("WO-139 delete chat for me", () => {
  it("routes deletion through the server-authoritative RPC only", () => {
    expect(dmLib).toContain("delete_dm_conversation_for_me");
    // No client-side writes to conversation/participant state.
    expect(dmLib).not.toMatch(/from\(["']dm_conversation_clears["']\)/);
    expect(chats).not.toMatch(/from\(["']dm_conversations["']\)/);
  });

  it("never sends a client-supplied actor id", () => {
    expect(dmLib).not.toMatch(/_profile_id:\s/);
    const call = dmLib.slice(dmLib.indexOf("delete_dm_conversation_for_me"));
    expect(call.slice(0, 200)).toContain("_conversation_id: conversationId");
  });

  it("exposes a separate accessible conversation-options control per card", () => {
    expect(chats).toContain("Conversation options for ${item.other.firstName}");
    expect(chats).toContain("conversation-options-");
    // The options control lives outside the Link so it cannot open the chat.
    expect(chats.indexOf("</Link>")).toBeLessThan(
      chats.indexOf("Conversation options for"),
    );
    // Adequate touch target.
    expect(chats).toContain("w-11 h-11");
  });

  it("offers Delete chat in both the list card and the conversation menu", () => {
    expect(chats).toContain("Delete chat");
    expect(dm).toContain("Delete chat");
    expect(chats).toContain("text-destructive");
    expect(dm).toContain("text-destructive");
  });

  it("does not add conversation deletion to Meetup group chats", () => {
    expect(meetupChat).not.toContain("DeleteChatDialog");
    expect(meetupChat).not.toContain("delete_dm_conversation_for_me");
  });

  it("uses a destructive confirmation dialog with title and description", () => {
    expect(dialog).toContain("Delete this chat?");
    expect(dialog).toContain("It will\n            remain available to the other person");
    expect(dialog).toContain("AlertDialogCancel");
    expect(dialog).toContain("AlertDialogTitle");
    expect(dialog).toContain("AlertDialogDescription");
  });

  it("only removes the row from local state after the server confirms", () => {
    const body = chats.slice(chats.indexOf("const confirmDelete"));
    expect(body.indexOf("await deleteConversationForMe")).toBeLessThan(
      body.indexOf("qc.setQueryData"),
    );
    // Failure path keeps the conversation and reports a retryable error.
    expect(body).toContain("showErrorToast");
    expect(body).toContain("Couldn't delete this chat. Please try again.");
  });

  it("announces results and manages focus", () => {
    expect(chats).toContain('aria-live="polite"');
    expect(chats).toContain("moveFocusAfterDelete");
    expect(chats).toContain("focusChatsHeading");
    // Deleting from inside a conversation redirects and focuses the heading.
    expect(dm).toContain('navigate("/chats"');
    expect(dm).toContain("focusChatsHeading: true");
  });

  it("preserves WO-136/137/138 message behavior", () => {
    expect(dm).toContain("deleteDirectMessage");
    expect(dm).toContain("editDirectMessage");
    expect(dm).toContain("toggleDirectMessageReaction");
    expect(dm).toContain("messageRowAlignment");
  });
});

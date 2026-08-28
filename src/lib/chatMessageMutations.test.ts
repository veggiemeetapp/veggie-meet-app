import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * WO-136 — client contract tests for edit/delete of own chat messages.
 * Authorization is enforced server-side inside the RPCs; these tests lock the
 * client validation, RPC names/arguments and tombstone helpers.
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  editDirectMessage,
  deleteDirectMessage,
  isDeletedMessage,
  MESSAGE_DELETED_LABEL,
  MESSAGE_MAX,
} from "@/lib/directMessages";
import {
  editMeetupChatMessage,
  deleteMeetupChatMessage,
  isDeletedChatMessage,
  CHAT_MESSAGE_MAX,
} from "@/lib/meetupChat";

beforeEach(() => {
  rpc.mockReset();
});

describe("tombstone helpers", () => {
  it("uses neutral copy", () => {
    expect(MESSAGE_DELETED_LABEL).toBe("Message deleted");
  });

  it("detects deleted DM messages from either flag", () => {
    expect(isDeletedMessage({ is_deleted: true })).toBe(true);
    expect(isDeletedMessage({ deleted_at: "2026-01-01T00:00:00Z" })).toBe(true);
    expect(isDeletedMessage({ deleted_at: null, is_deleted: false })).toBe(false);
  });

  it("detects deleted group messages", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isDeletedChatMessage({ is_deleted: true } as any)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isDeletedChatMessage({ body: "hi" } as any)).toBe(false);
  });
});

describe("editDirectMessage", () => {
  it("trims and calls edit_dm_message", async () => {
    rpc.mockResolvedValue({ data: { id: "m1", body: "hello" }, error: null });
    await editDirectMessage("m1", "  hello  ");
    expect(rpc).toHaveBeenCalledWith("edit_dm_message", {
      _message_id: "m1",
      _body: "hello",
    });
  });

  it("rejects whitespace-only edits without calling the server", async () => {
    await expect(editDirectMessage("m1", "   ")).rejects.toThrow(
      /can't be empty/i,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enforces the maximum length client-side too", async () => {
    await expect(
      editDirectMessage("m1", "x".repeat(MESSAGE_MAX + 1)),
    ).rejects.toThrow(new RegExp(String(MESSAGE_MAX)));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces server rejections (ownership, deleted, access)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "You can only edit your own messages" },
    });
    await expect(editDirectMessage("m1", "hi")).rejects.toBeTruthy();
  });
});

describe("deleteDirectMessage", () => {
  it("calls delete_dm_message and returns the tombstone row", async () => {
    rpc.mockResolvedValue({
      data: { id: "m1", body: null, is_deleted: true },
      error: null,
    });
    const row = await deleteDirectMessage("m1");
    expect(rpc).toHaveBeenCalledWith("delete_dm_message", { _message_id: "m1" });
    expect(row.body).toBeNull();
    expect(isDeletedMessage(row)).toBe(true);
  });

  it("propagates repeated-deletion rejection", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Message already deleted" },
    });
    await expect(deleteDirectMessage("m1")).rejects.toBeTruthy();
  });
});

describe("meetup chat mutations", () => {
  it("edits via edit_meetup_chat_message", async () => {
    rpc.mockResolvedValue({ data: { id: "m2", body: "new" }, error: null });
    await editMeetupChatMessage("m2", " new ");
    expect(rpc).toHaveBeenCalledWith("edit_meetup_chat_message", {
      _message_id: "m2",
      _body: "new",
    });
  });

  it("rejects empty and over-long group edits", async () => {
    await expect(editMeetupChatMessage("m2", "  ")).rejects.toThrow(
      /can't be empty/i,
    );
    await expect(
      editMeetupChatMessage("m2", "x".repeat(CHAT_MESSAGE_MAX + 1)),
    ).rejects.toThrow(new RegExp(String(CHAT_MESSAGE_MAX)));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deletes via delete_meetup_chat_message", async () => {
    rpc.mockResolvedValue({
      data: { id: "m2", body: null, is_deleted: true },
      error: null,
    });
    const row = await deleteMeetupChatMessage("m2");
    expect(rpc).toHaveBeenCalledWith("delete_meetup_chat_message", {
      _message_id: "m2",
    });
    expect(isDeletedChatMessage(row)).toBe(true);
  });
});

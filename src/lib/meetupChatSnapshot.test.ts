import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  fetchMeetupChatSnapshot,
  MEETUP_CHAT_TIMEOUT_MESSAGE,
} from "@/lib/meetupChat";

beforeEach(() => {
  rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchMeetupChatSnapshot", () => {
  it("loads context before the bounded first message page", async () => {
    rpc
      .mockResolvedValueOnce({
        data: { can_read: true, can_post: true, meetup: { id: "m1" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { messages: [{ id: "msg1" }], has_more: true },
        error: null,
      });

    const result = await fetchMeetupChatSnapshot("chat1", 1_000);

    expect(result.context.can_read).toBe(true);
    expect(result.messages).toEqual([
      expect.objectContaining({ id: "msg1", reactions: [] }),
    ]);
    expect(result.hasMore).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "get_meetup_chat_context", {
      _chat_id: "chat1",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_meetup_chat_thread", {
      _chat_id: "chat1",
      _before_created_at: null,
      _before_id: null,
      _limit: 40,
    });
  });

  it("does not fetch messages when the member cannot read the chat", async () => {
    rpc.mockResolvedValueOnce({ data: { can_read: false }, error: null });

    const result = await fetchMeetupChatSnapshot("chat1", 1_000);

    expect(result.messages).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects a stalled request instead of loading forever", async () => {
    vi.useFakeTimers();
    rpc.mockImplementation(() => new Promise(() => undefined));

    const request = fetchMeetupChatSnapshot("chat1", 1_000);
    const rejection = expect(request).rejects.toThrow(
      MEETUP_CHAT_TIMEOUT_MESSAGE,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  DM_THREAD_TIMEOUT_MESSAGE,
  fetchThreadSnapshot,
} from "@/lib/directMessages";

beforeEach(() => {
  rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchThreadSnapshot", () => {
  it("returns the bounded first DM page", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        conversation_id: "conversation-1",
        peer: {
          profile_id: "profile-2",
          display_name: "Alex Green",
          avatar_url: null,
          city: "Austin",
          is_verified_connection: true,
        },
        messages: [{ id: "message-1", reactions: [] }],
        has_more: true,
        can_send: true,
        is_blocked: false,
        is_connected: true,
      },
      error: null,
    });

    const result = await fetchThreadSnapshot("conversation-1", 1_000);

    expect(result.other.firstName).toBe("Alex");
    expect(result.messages).toEqual([
      expect.objectContaining({ id: "message-1", reactions: [] }),
    ]);
    expect(result.hasMore).toBe(true);
    expect(rpc).toHaveBeenCalledWith("get_dm_thread", {
      _conversation_id: "conversation-1",
      _before_created_at: null,
      _before_id: null,
      _limit: 40,
    });
  });

  it("rejects a stalled DM request instead of loading forever", async () => {
    vi.useFakeTimers();
    rpc.mockImplementation(() => new Promise(() => undefined));

    const request = fetchThreadSnapshot("conversation-1", 1_000);
    const rejection = expect(request).rejects.toThrow(
      DM_THREAD_TIMEOUT_MESSAGE,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
  });
});

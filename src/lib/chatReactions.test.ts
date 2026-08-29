import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * WO-137 — client contract tests for emoji reactions.
 * Authorization, membership and the approved-emoji allowlist are enforced
 * server-side; these tests lock the pure helpers, RPC names/arguments and the
 * member-safe shape of reaction summaries (emoji/count/mine only).
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  REACTION_EMOJIS,
  isApprovedReactionEmoji,
  normalizeReactions,
  optimisticToggle,
  reactionName,
  reactionPillLabel,
  toggleDirectMessageReaction,
  toggleMeetupMessageReaction,
  fetchDirectMessageReactions,
  fetchMeetupMessageReactions,
} from "@/lib/chatReactions";

beforeEach(() => rpc.mockReset());

describe("approved emoji set", () => {
  it("is exactly the six approved reactions", () => {
    expect(REACTION_EMOJIS.map((r) => r.emoji)).toEqual([
      "👍",
      "❤️",
      "😂",
      "🎉",
      "😮",
      "🙏",
    ]);
  });

  it("rejects anything outside the allowlist", () => {
    expect(isApprovedReactionEmoji("👍")).toBe(true);
    expect(isApprovedReactionEmoji("🥕")).toBe(false);
    expect(isApprovedReactionEmoji("")).toBe(false);
  });

  it("names every emoji for assistive technology", () => {
    expect(reactionName("🙏")).toBe("Folded hands");
    expect(reactionName("🥕")).toBe("Reaction");
  });
});

describe("normalizeReactions", () => {
  it("drops unknown emoji, non-positive counts and non-arrays", () => {
    expect(
      normalizeReactions([
        { emoji: "🥕", count: 3, mine: true },
        { emoji: "👍", count: 0, mine: false },
        { emoji: "❤️", count: 2, mine: true },
      ]),
    ).toEqual([{ emoji: "❤️", count: 2, mine: true }]);
    expect(normalizeReactions(null)).toEqual([]);
    expect(normalizeReactions(undefined)).toEqual([]);
  });

  it("keeps the stable approved-set order", () => {
    const sorted = normalizeReactions([
      { emoji: "🙏", count: 1, mine: false },
      { emoji: "👍", count: 4, mine: true },
    ]);
    expect(sorted.map((r) => r.emoji)).toEqual(["👍", "🙏"]);
  });

  it("never surfaces reactor identities", () => {
    const [r] = normalizeReactions([
      { emoji: "👍", count: 1, mine: true, profile_id: "leak" },
    ]);
    expect(Object.keys(r).sort()).toEqual(["count", "emoji", "mine"]);
  });
});

describe("optimisticToggle", () => {
  it("adds a first reaction as mine", () => {
    expect(optimisticToggle([], "👍")).toEqual([
      { emoji: "👍", count: 1, mine: true },
    ]);
  });

  it("removes my reaction and drops empty pills", () => {
    expect(optimisticToggle([{ emoji: "👍", count: 1, mine: true }], "👍")).toEqual(
      [],
    );
  });

  it("keeps other members' counts when I remove mine", () => {
    expect(optimisticToggle([{ emoji: "👍", count: 3, mine: true }], "👍")).toEqual(
      [{ emoji: "👍", count: 2, mine: false }],
    );
  });

  it("joins an existing reaction once", () => {
    const once = optimisticToggle([{ emoji: "❤️", count: 1, mine: false }], "❤️");
    expect(once).toEqual([{ emoji: "❤️", count: 2, mine: true }]);
    // Toggling again removes it — one reaction per member per emoji.
    expect(optimisticToggle(once, "❤️")).toEqual([
      { emoji: "❤️", count: 1, mine: false },
    ]);
  });

  it("never goes negative", () => {
    expect(optimisticToggle([{ emoji: "😂", count: 0, mine: true }], "😂")).toEqual(
      [],
    );
  });
});

describe("accessible pill labels", () => {
  it("announces emoji name, count and my state", () => {
    expect(reactionPillLabel({ emoji: "👍", count: 1, mine: true })).toBe(
      "Thumbs up, 1 reaction, you reacted",
    );
    expect(reactionPillLabel({ emoji: "👍", count: 2, mine: false })).toBe(
      "Thumbs up, 2 reactions, you have not reacted",
    );
  });
});

describe("server wrappers", () => {
  it("toggles a DM reaction through the RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        message_id: "m1",
        emoji: "👍",
        reacted: true,
        reactions: [{ emoji: "👍", count: 1, mine: true }],
      },
      error: null,
    });
    const res = await toggleDirectMessageReaction("m1", "👍");
    expect(rpc).toHaveBeenCalledWith("toggle_dm_message_reaction", {
      _message_id: "m1",
      _emoji: "👍",
    });
    expect(res.reacted).toBe(true);
    expect(res.reactions).toEqual([{ emoji: "👍", count: 1, mine: true }]);
  });

  it("toggles a Meetup chat reaction through the RPC", async () => {
    rpc.mockResolvedValue({
      data: { message_id: "m2", emoji: "🎉", reacted: false, reactions: [] },
      error: null,
    });
    const res = await toggleMeetupMessageReaction("m2", "🎉");
    expect(rpc).toHaveBeenCalledWith("toggle_meetup_message_reaction", {
      _message_id: "m2",
      _emoji: "🎉",
    });
    expect(res.reactions).toEqual([]);
  });

  it("blocks unapproved emoji before any network call", async () => {
    await expect(toggleDirectMessageReaction("m1", "🥕")).rejects.toThrow(
      /not available/i,
    );
    await expect(toggleMeetupMessageReaction("m2", "🥕")).rejects.toThrow(
      /not available/i,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces server rejections (membership, tombstones, forged ids)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "You can't react to this message" },
    });
    await expect(toggleDirectMessageReaction("m1", "👍")).rejects.toBeTruthy();
  });

  it("reads authoritative summaries for a loaded page", async () => {
    rpc.mockResolvedValue({
      data: { m1: [{ emoji: "👍", count: 2, mine: false }], m2: [] },
      error: null,
    });
    const map = await fetchDirectMessageReactions("c1", ["m1", "m2"]);
    expect(rpc).toHaveBeenCalledWith("get_dm_message_reactions", {
      _conversation_id: "c1",
      _message_ids: ["m1", "m2"],
    });
    expect(map.m1[0].count).toBe(2);
    expect(map.m2).toEqual([]);
  });

  it("reads Meetup summaries with the chat scope", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await fetchMeetupMessageReactions("chat1");
    expect(rpc).toHaveBeenCalledWith("get_meetup_message_reactions", {
      _chat_id: "chat1",
      _message_ids: null,
    });
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dm = readFileSync("src/screens/DirectMessage.tsx", "utf8");
const meetup = readFileSync("src/screens/MeetupChat.tsx", "utf8");
const tailwind = readFileSync("tailwind.config.ts", "utf8");

describe("chat cache and entrance animation contracts", () => {
  it("scopes the DM cache to the conversation and signed-in member", () => {
    expect(dm).toContain('["dm-thread", conversationId, meProfileId]');
    expect(dm).toContain("() => threadQuery.data?.messages ?? []");
    expect(dm).toContain('refetchOnMount: "always"');
    expect(dm).toContain("qc.setQueryData<DMThread>(threadKey");
    expect(dm).toContain("useLayoutEffect(() => {");
  });

  it("keeps the Meetup cache synchronized with live local content", () => {
    expect(meetup).toContain("qc.setQueryData<MeetupChatSnapshot>(chatKey");
    expect(meetup).toContain("cached.messages === messages");
    expect(meetup).toContain("useLayoutEffect(() => {");
  });

  it("animates both chat contents downward without forcing reduced motion", () => {
    expect(dm).toContain('data-chat-content="dm"');
    expect(meetup).toContain('data-chat-content="group"');
    expect(dm).toContain("motion-safe:animate-chat-content-in");
    expect(meetup).toContain("motion-safe:animate-chat-content-in");
    expect(tailwind).toContain('"chat-content-in"');
    expect(tailwind).toContain('translateY(-10px)');
  });

  it("bounds both cold-load requests and exposes retry controls", () => {
    expect(dm).toContain("DM_THREAD_TIMEOUT_MESSAGE");
    expect(dm).toContain("onClick={() => void threadQuery.refetch()}");
    expect(meetup).toContain("MEETUP_CHAT_TIMEOUT_MESSAGE");
    expect(meetup).toContain("onClick={() => void chatQuery.refetch()}");
  });
});

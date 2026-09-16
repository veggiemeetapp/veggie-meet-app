import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { messageRowAlignment } from "@/lib/chatMessageLayout";

const dmSource = readFileSync("src/screens/DirectMessage.tsx", "utf8");
const meetupSource = readFileSync("src/screens/MeetupChat.tsx", "utf8");

describe("WO-138 per-message chat alignment", () => {
  it("anchors every outgoing message row right and every incoming row left", () => {
    expect(messageRowAlignment(true)).toBe("justify-end");
    expect(messageRowAlignment(false)).toBe("justify-start");
  });

  it("applies ownership alignment to each Direct Message inside a grouped run", () => {
    expect(dmSource).toContain('data-message-row={m.id}');
    expect(dmSource).toContain('data-message-owner={isMe ? "self" : "other"}');
    expect(dmSource).toMatch(
      /group\/msg relative flex min-w-0 max-w-full items-start gap-1\.5[\s\S]*?messageRowAlignment\(isMe\)/,
    );
  });

  it("uses the same independent ownership contract for Meetup chat rows", () => {
    expect(meetupSource).toContain('data-message-row={m.id}');
    expect(meetupSource).toContain('data-message-owner={isMe ? "self" : "other"}');
    expect(meetupSource).toMatch(
      /flex min-w-0 max-w-full items-end gap-2[\s\S]*?messageRowAlignment\(isMe\)/,
    );
  });

  it("keeps established width limits for long messages on both surfaces", () => {
    expect(dmSource).toContain('min-w-0 max-w-[86%] flex flex-col');
    expect(meetupSource).toContain('min-w-0 max-w-[75%] flex flex-col');
    expect(dmSource).toContain("[overflow-wrap:anywhere]");
    expect(meetupSource).toContain("[overflow-wrap:anywhere]");
    expect(dmSource).toContain("overflow-y-auto overflow-x-hidden");
    expect(meetupSource).toContain("overflow-y-auto overflow-x-hidden");
  });

  it("does not stretch a short Meetup bubble to the width of its reactions", () => {
    expect(meetupSource).toContain('isMe ? "items-end" : "items-start"');
    expect(meetupSource).toContain("w-fit min-w-0 max-w-full rounded-card");
    expect(meetupSource).not.toContain("rounded-br-md");
  });
});

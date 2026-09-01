import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-141 — layout contract for chat surfaces (DM and Meetup Chat).
 * These surfaces must use dynamic viewport units (dvh) to stay reachable 
 * when the virtual keyboard is open.
 */
const dmSrc = readFileSync("src/screens/DirectMessage.tsx", "utf8");
const meetupSrc = readFileSync("src/screens/MeetupChat.tsx", "utf8");

describe("Chat viewport contracts", () => {
  it("uses the app-viewport class in DirectMessage for keyboard resilience", () => {
    expect(dmSrc).toContain('className="app-viewport');
  });

  it("uses the app-viewport class in MeetupChat for keyboard resilience", () => {
    expect(meetupSrc).toContain('className="app-viewport');
  });

  it("implements a flex-column layout to keep the composer docked at the bottom", () => {
    // Both should be flex-col so the message list grows/shrinks within the remaining space
    expect(dmSrc).toContain('flex-col');
    expect(meetupSrc).toContain('flex-col');
  });
});

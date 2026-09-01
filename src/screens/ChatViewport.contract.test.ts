import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-141 — layout contract for chat surfaces (DM and Meetup Chat).
 * These surfaces must use dynamic viewport units (dvh) to stay reachable 
 * when the virtual keyboard is open.
 */
const dmSrc = readFileSync("src/screens/DirectMessage.tsx", "utf8");
const meetupSrc = readFileSync("src/screens/MeetupChat.tsx", "utf8");
const appShellSrc = readFileSync("src/components/app/AppShell.tsx", "utf8");

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

  it("hides the global bottom nav on both focused chat routes", () => {
    expect(appShellSrc).toContain('/^\\/chat\\//');
    expect(appShellSrc).toContain('/^\\/dm\\//');
    expect(appShellSrc).toContain("paddingBottom: hideNav ? 0");
  });

  it("anchors the route announcement inside the viewport boundary", () => {
    expect(appShellSrc).toContain("data-route-announcer");
    expect(appShellSrc).toContain('className="sr-only left-0 top-0"');
  });

  it("anchors chat status announcements instead of extending the document", () => {
    expect(dmSrc).toContain('data-chat-status="dm"');
    expect(meetupSrc).toContain('data-chat-status="group"');
    expect(dmSrc).toMatch(/data-chat-status="dm"[\s\S]*?className="sr-only left-0 top-0"/);
    expect(meetupSrc).toMatch(/data-chat-status="group"[\s\S]*?className="sr-only left-0 top-0"/);
  });
});

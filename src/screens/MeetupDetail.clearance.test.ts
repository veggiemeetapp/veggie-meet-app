import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-130 DEF-130-01 — the Meetup detail content must reserve the sticky action
 * panel's *actual* height, not a fixed padding class. The host state renders
 * five stacked rows, which exceeded the old `pb-32` (8rem) and hid the tail of
 * the description until the user overscrolled.
 */
const src = readFileSync("src/screens/MeetupDetail.tsx", "utf8");
const hook = readFileSync("src/hooks/useStickyPanelHeight.ts", "utf8");

describe("Meetup detail sticky action panel clearance", () => {
  it("no longer relies on the fixed pb-32 clearance", () => {
    expect(src).not.toMatch(/className="pb-32"/);
  });

  it("measures the action panel and pads the page by that height plus a gap", () => {
    expect(src).toContain("useStickyPanelHeight");
    expect(src).toContain('ref={panelRef}');
    expect(src).toContain("calc(${panelHeight}px + 1rem)");
  });

  it("falls back to a safe-area aware clearance before measurement", () => {
    expect(src).toContain('"calc(8rem + env(safe-area-inset-bottom))"');
  });

  it("keeps the panel's own safe-area padding (measured, so never double-applied)", () => {
    expect(src).toMatch(/fixed bottom-0[^"]*safe-bottom/);
    expect(hook).toContain("getBoundingClientRect");
  });

  it("keeps the panel above page content in the stacking order but below BottomNav", () => {
    expect(src).toMatch(/fixed bottom-0[^"]*z-30/);
  });

  it("observes size changes (state/text-scaling) and cleans the observer up", () => {
    expect(hook).toContain("ResizeObserver");
    expect(hook).toContain("observer.disconnect()");
  });

  it("does not attach global scroll listeners", () => {
    expect(hook).not.toContain('"scroll"');
  });
});

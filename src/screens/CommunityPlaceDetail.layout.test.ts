import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-102 DEF-102-01 — layout contract for the Community Place sticky action bar.
 *
 * These are source-contract assertions, not pixel snapshots: the defect was a
 * missing safe-area term in the fixed `bottom` calculation, which is exactly the
 * kind of thing that silently regresses when someone edits the container.
 */
const src = readFileSync("src/screens/CommunityPlaceDetail.tsx", "utf8");

describe("Community Place sticky action bar", () => {
  it("anchors above the rendered bottom nav including the device safe-area inset", () => {
    expect(src).toContain('bottom: "calc(var(--nav-height) + env(safe-area-inset-bottom))"');
  });

  it("never sits above BottomNav (z-40) or sheets in the stacking order", () => {
    expect(src).toMatch(/className="fixed z-10 left-1\/2/);
  });

  it("reserves page bottom padding for the bar, nav and safe area", () => {
    expect(src).toContain(
      'paddingBottom: "calc(var(--nav-height) + env(safe-area-inset-bottom) + 5rem)"',
    );
  });

  it("keeps all three check-in states inside the same sticky container geometry", () => {
    // normal, already-checked-in (cooldown) and non-operational states share the
    // one flex row, so none of them can introduce its own spacing.
    expect(src).toContain("Check In");
    expect(src).toContain("Checked In");
    expect(src).toContain("Check-in unavailable");
    expect(src).toMatch(/flex gap-2/);
  });

  it("sizes both actions identically so left/right buttons align", () => {
    const matches = src.match(/flex-1 min-w-0 px-4 text-\[15px\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

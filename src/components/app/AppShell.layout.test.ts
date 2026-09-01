import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-141 — layout contract for the application shell and navigation.
 */
const src = readFileSync("src/components/app/AppShell.tsx", "utf8");

describe("AppShell layout contract", () => {
  it("reserves space for bottom nav and safe-area in the main content region", () => {
    // This calculation ensures the content isn't trapped behind the nav on mobile devices
    expect(src).toContain('paddingBottom: hideNav ? 0 : "calc(var(--nav-height) + env(safe-area-inset-bottom))"');
  });

  it("hides the bottom nav for focused chat surfaces to allow full-height viewport", () => {
    // The HIDDEN_NAV_PATTERNS must include chat and dm routes
    expect(src).toContain("/^\\/chat\\//");
    expect(src).toContain("/^\\/dm\\//");
  });
});

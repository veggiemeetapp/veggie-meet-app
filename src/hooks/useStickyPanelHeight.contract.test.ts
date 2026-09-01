import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WO-141 — contract for sticky panel measurement.
 */
const src = readFileSync("src/hooks/useStickyPanelHeight.ts", "utf8");

describe("useStickyPanelHeight contract", () => {
  it("listens for orientation changes to handle safe-area inset shifts", () => {
    // Orientation changes often shift safe-areas on mobile without a layout resize
    expect(src).toContain('window.addEventListener("orientationchange", measure)');
  });

  it("uses ResizeObserver for performant layout tracking", () => {
    expect(src).toContain('new ResizeObserver(measure)');
  });
});

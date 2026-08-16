import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WO-113 — "Veggie Since" is removed from the member-facing profile.
 *
 * The value was never a database column: it was derived at render time from
 * `profiles.created_at`. This guard keeps the label (and any re-derivation of a
 * profile "since" date) from creeping back into the profile surfaces.
 */
const files = [
  "src/screens/You.tsx",
  "src/screens/EditProfile.tsx",
  "src/screens/VeggieProfile.tsx",
  "src/screens/Onboarding.tsx",
];

describe("WO-113 profile surfaces", () => {
  for (const file of files) {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    // Strip comments so the explanatory WO-113 notes don't trip the assertions.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    it(`${file} renders no "Veggie since" label`, () => {
      expect(code.toLowerCase()).not.toContain("veggie since");
    });

    it(`${file} does not derive a member-since date`, () => {
      expect(code).not.toMatch(/memberSince|veggie_since|vegan_since|vegetarian_since/);
    });
  }
});

/**
 * WO-113A — /you production regression guards.
 *
 * Root cause of DEF-113A-01 was a stale/mixed production asset set (missing
 * lazy chunks), not application code. The two guards below cover the real UI
 * defects found while re-certifying the page on production.
 */
describe("WO-113A /you profile card", () => {
  const code = readFileSync(resolve(process.cwd(), "src/screens/You.tsx"), "utf8");

  it("profile actions row wraps instead of forcing a fixed 2-up row", () => {
    expect(code).toMatch(/flex w-full flex-wrap gap-2/);
  });

  it("past-meetup Hosted badge does not use the low-contrast amber-on-amber pair", () => {
    expect(code).not.toMatch(/bg-host-badge\/15 text-host-badge/);
  });
});

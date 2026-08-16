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

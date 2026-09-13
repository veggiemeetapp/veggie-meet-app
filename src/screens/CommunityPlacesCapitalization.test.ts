import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const community = readFileSync(resolve(process.cwd(), "src/screens/Community.tsx"), "utf8");
const today = readFileSync(resolve(process.cwd(), "src/screens/Today.tsx"), "utf8");

describe("WO-150 Community Places capitalization", () => {
  it("uses the canonical category name in the Community section heading", () => {
    expect(community).toContain('title="Community Places nearby"');
    expect(community).not.toContain('title="Community places nearby"');
  });

  it("uses the canonical category name in the Today accessibility label", () => {
    expect(today).toContain('aria-label="Community Places"');
    expect(today).not.toContain('aria-label="Community places"');
  });
});
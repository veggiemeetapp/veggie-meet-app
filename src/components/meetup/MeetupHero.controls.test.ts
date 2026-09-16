import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/meetup/MeetupHero.tsx", "utf8");

describe("Meetup hero controls", () => {
  it("shares the same visible surface between Back and the right-side controls", () => {
    expect(source).toContain("const heroControlSurface = hasImage");
    expect(source).toContain(
      '<BackButton fallback="/community" className={heroControlSurface} />',
    );
    expect(source).toMatch(/const roundBtn = cn\([\s\S]*heroControlSurface/);
  });
});

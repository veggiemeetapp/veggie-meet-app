import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const management = readFileSync("src/screens/MeetupManagement.tsx", "utf8");
const picker = readFileSync(
  "src/components/host/CommunityPlacePicker.tsx",
  "utf8",
);

describe("Meetup management layout", () => {
  it("keeps the primary Save changes action fixed above the viewport edge", () => {
    expect(management).toContain("data-meetup-save-bar");
    expect(management).toContain("fixed inset-x-0 bottom-0 z-30");
    expect(management).toContain("max-w-phone");
    expect(management).toContain("pb-32");
    expect(management.match(/Save changes/g)).toHaveLength(1);
  });

  it("limits Community Place pickers to about three rows with internal scrolling", () => {
    expect(picker).toContain("data-community-place-scroll");
    expect(picker).toContain("max-h-72");
    expect(picker).toContain("overflow-y-auto");
    expect(picker).toContain("overscroll-contain");
    expect(picker).toContain("filtered.length > 3");
  });
});

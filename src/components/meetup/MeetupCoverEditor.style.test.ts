import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/meetup/MeetupCoverEditor.tsx"),
  "utf8",
);

describe("Meetup cover destructive action", () => {
  it("renders Remove photo with the same bordered destructive treatment as Cancel Meetup", () => {
    const removeStart = source.indexOf('aria-label="Remove Meetup cover photo"');
    const removeButton = source.slice(removeStart - 150, removeStart + 500);
    expect(removeButton).toContain("<SecondaryButton");
    expect(removeButton).toContain(
      'className="border-destructive/40 text-destructive hover:bg-destructive/10"',
    );
  });
});

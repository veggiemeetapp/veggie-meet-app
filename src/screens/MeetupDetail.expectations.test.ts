import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WO-129 — the member-facing "What to expect" section is removed.
 *
 * The expectation cards were hard-coded presentation only: they were never
 * stored on a Meetup, never sent to any RPC, and never used by search,
 * recommendations, notifications, calendar or share. These guards keep the
 * generic cards (and the host-side chooser that collected the same labels
 * without persisting them) from returning.
 */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const read = (file: string) =>
  strip(readFileSync(resolve(process.cwd(), file), "utf8"));

describe("WO-129 What to expect removal", () => {
  it("the WhatToExpect component no longer exists", () => {
    expect(existsSync(resolve(process.cwd(), "src/components/meetup/WhatToExpect.tsx"))).toBe(
      false,
    );
  });

  it("the meetup barrel no longer exports WhatToExpect", () => {
    expect(read("src/components/meetup/index.ts")).not.toContain("WhatToExpect");
  });

  const phrases = [
    "what to expect",
    "casual conversation",
    "everyone is welcome",
    "everyone welcome",
    "small, friendly group",
    "small group",
  ];

  for (const file of ["src/screens/MeetupDetail.tsx", "src/screens/Host.tsx", "src/screens/MeetupManagement.tsx"]) {
    // The Description placeholder ("Tell everyone what to expect.") is host-written
    // copy for a preserved field, not the retired expectation feature.
    const code = read(file).toLowerCase().replace("tell everyone what to expect.", "");
    for (const phrase of phrases) {
      it(`${file} does not render "${phrase}"`, () => {
        expect(code).not.toContain(phrase);
      });
    }
    it(`${file} keeps no expectation state`, () => {
      expect(code).not.toContain("expectation");
    });
  }

  it("meetup detail still renders the meaningful sections", () => {
    const code = read("src/screens/MeetupDetail.tsx");
    for (const marker of [
      "MeetupHero",
      "MeetupInfo",
      "MeetupPlaceSection",
      "MeetupInterestTags",
      "HostCard",
      "AttendeePreview",
      "MeetupDescription",
      "AddToGoogleCalendarButton",
      "MeetupCheckInButton",
      "Open meetup chat",
      "Manage Meetup",
    ]) {
      expect(code).toContain(marker);
    }
  });
});

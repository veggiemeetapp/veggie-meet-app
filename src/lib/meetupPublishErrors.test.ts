import { describe, expect, it } from "vitest";
import {
  classifyMeetupPublishError,
  validateMeetupDraft,
  isAllowedCoverFile,
  MEETUP_COVER_MAX_CHARS,
  MEETUP_COVER_MAX_INPUT_BYTES,
  MEETUP_TITLE_MAX,
  type MeetupDraft,
} from "@/lib/meetupPublishErrors";


/**
 * WO-131 — the publish contract must stay honest in both directions:
 * every rule the server enforces is mirrored here, and every rule the server
 * raises maps to actionable, member-safe copy (never raw SQL detail).
 */

const NOW = new Date("2026-05-01T10:00:00Z");

function draft(overrides: Partial<MeetupDraft> = {}): MeetupDraft {
  return {
    title: "Saigon Plant-Based Social",
    description: "A relaxed evening of plant-based food and good company.",
    date: "2026-06-01",
    startTime: "18:00",
    endTime: "",
    capacity: 15,
    cityId: "city-1",
    primaryInterestId: "vegan_food",
    additionalInterestIds: ["coffee", "workshops_learning"],
    communityPlaceId: "place-1",
    isCustomLocation: false,
    customName: "",
    customAddress: "",
    coverChars: 1200,
    now: NOW,
    ...overrides,
  };
}

describe("validateMeetupDraft — the reported incident payload", () => {
  it("accepts the exact DEF-131-01 draft (capacity 15, 3 categories)", () => {
    expect(validateMeetupDraft(draft())).toEqual([]);
  });

  it("accepts capacity 15 specifically", () => {
    expect(validateMeetupDraft(draft({ capacity: 15 }))).toEqual([]);
  });

  it("flags the oversized cover that actually caused the failure", () => {
    const issues = validateMeetupDraft(draft({ coverChars: MEETUP_COVER_MAX_CHARS + 1 }));
    expect(issues.map((i) => i.code)).toContain("MEETUP_COVER_TOO_LARGE");
    expect(issues[0].field).toBe("cover");
  });
});

describe("validateMeetupDraft — server rule mirror", () => {
  it("requires a title", () => {
    expect(validateMeetupDraft(draft({ title: "   " }))[0].code).toBe("MEETUP_TITLE_REQUIRED");
  });

  it("rejects an over-long title", () => {
    const issues = validateMeetupDraft(draft({ title: "x".repeat(MEETUP_TITLE_MAX + 1) }));
    expect(issues[0].code).toBe("MEETUP_TITLE_TOO_LONG");
  });

  it("requires a main category", () => {
    const codes = validateMeetupDraft(draft({ primaryInterestId: null })).map((i) => i.code);
    expect(codes).toContain("MEETUP_PRIMARY_INTEREST_REQUIRED");
  });

  it("rejects more than two additional categories", () => {
    const codes = validateMeetupDraft(
      draft({ additionalInterestIds: ["a", "b", "c"] }),
    ).map((i) => i.code);
    expect(codes).toContain("MEETUP_ADDITIONAL_INTERESTS_INVALID");
  });

  it("ignores an additional category that duplicates the primary", () => {
    expect(
      validateMeetupDraft(draft({ additionalInterestIds: ["vegan_food", "coffee"] })),
    ).toEqual([]);
  });

  it("rejects capacity outside 1–500", () => {
    expect(validateMeetupDraft(draft({ capacity: 0 }))[0].code).toBe("MEETUP_CAPACITY_INVALID");
    expect(validateMeetupDraft(draft({ capacity: 501 }))[0].code).toBe("MEETUP_CAPACITY_INVALID");
    expect(validateMeetupDraft(draft({ capacity: null }))[0].code).toBe("MEETUP_CAPACITY_INVALID");
  });

  it("rejects a past start and a start more than a year ahead", () => {
    expect(validateMeetupDraft(draft({ date: "2026-04-01" }))[0].code).toBe("MEETUP_TIME_PAST");
    expect(validateMeetupDraft(draft({ date: "2027-09-01" }))[0].code).toBe("MEETUP_TIME_TOO_FAR");
  });

  it("rejects an end time at or before the start", () => {
    expect(validateMeetupDraft(draft({ endTime: "18:00" }))[0].code).toBe("MEETUP_TIME_INVALID");
  });

  it("requires a Community Place when not using a custom location", () => {
    expect(validateMeetupDraft(draft({ communityPlaceId: null }))[0].code).toBe(
      "MEETUP_PLACE_INVALID",
    );
  });

  it("requires a name and address for a custom location", () => {
    const codes = validateMeetupDraft(
      draft({ isCustomLocation: true, communityPlaceId: null }),
    ).map((i) => i.code);
    expect(codes).toEqual(["MEETUP_LOCATION_INVALID", "MEETUP_LOCATION_INVALID"]);
  });

  it("reports every problem at once so the host fixes them in one pass", () => {
    const issues = validateMeetupDraft(
      draft({ title: "", primaryInterestId: null, capacity: 900, cityId: null }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });
});

describe("classifyMeetupPublishError", () => {
  const raised = (message: string, code = "P0001") => ({ message, code });

  it("maps the cover-size rule to the cover field", () => {
    const err = classifyMeetupPublishError(raised("Cover image is too large"));
    expect(err.code).toBe("MEETUP_COVER_TOO_LARGE");
    expect(err.field).toBe("cover");
  });

  it("maps each server rule to its field", () => {
    expect(classifyMeetupPublishError(raised("Title is required")).field).toBe("title");
    expect(classifyMeetupPublishError(raised("Description too long")).field).toBe("description");
    expect(classifyMeetupPublishError(raised("Capacity must be between 1 and 500")).field).toBe(
      "capacity",
    );
    expect(classifyMeetupPublishError(raised("City unavailable")).field).toBe("city");
    expect(classifyMeetupPublishError(raised("A location name is required.")).field).toBe("place");
    expect(classifyMeetupPublishError(raised("An address is required.")).field).toBe("place");
    expect(
      classifyMeetupPublishError(raised("Choose a main category for this Meetup", "22023")).field,
    ).toBe("category");
    expect(
      classifyMeetupPublishError(raised("Pick at most 2 additional categories", "22023")).field,
    ).toBe("category");
  });

  it("never blames Meetup fields for a connectivity failure", () => {
    const err = classifyMeetupPublishError(new TypeError("Failed to fetch"));
    expect(err.code).toBe("MEETUP_OFFLINE");
    expect(err.field).toBeNull();
    expect(err.retryable).toBe(true);
  });

  it("treats an expired session as an auth problem", () => {
    const err = classifyMeetupPublishError({ message: "Not authenticated", status: 401 });
    expect(err.code).toBe("MEETUP_AUTH_EXPIRED");
  });

  it("never surfaces raw database detail", () => {
    const err = classifyMeetupPublishError({
      message:
        'permission denied for table meetups; new row violates row-level security policy (SQLSTATE 42501)',
      code: "42501",
    });
    expect(err.code).toBe("MEETUP_UNKNOWN");
    expect(`${err.title} ${err.description}`.toLowerCase()).not.toContain("row-level");
    expect(`${err.title} ${err.description}`.toLowerCase()).not.toContain("sqlstate");
  });

  it("always tells the host their details are preserved", () => {
    const err = classifyMeetupPublishError({ message: "boom", status: 500 });
    expect(err.description.toLowerCase()).toContain("still saved");
  });
});

// WO-131B — cover intake allowlist + server-side format rejection.
describe("WO-131B cover hardening", () => {
  it("accepts jpeg, png and webp within the size ceiling", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(isAllowedCoverFile({ type, size: 1024 })).toBe(true);
    }
  });

  it("rejects svg and other document-ish formats", () => {
    for (const type of ["image/svg+xml", "text/html", "application/pdf", ""]) {
      expect(isAllowedCoverFile({ type, size: 1024 })).toBe(false);
    }
  });

  it("rejects an input file too large to decode safely", () => {
    expect(
      isAllowedCoverFile({ type: "image/jpeg", size: MEETUP_COVER_MAX_INPUT_BYTES + 1 }),
    ).toBe(false);
  });

  it("is case-insensitive about the declared type", () => {
    expect(isAllowedCoverFile({ type: "IMAGE/JPEG", size: 10 })).toBe(true);
  });

  it("maps the server cover-format rejection to actionable cover copy", () => {
    const classified = classifyMeetupPublishError(
      new Error("That cover photo format isn't supported. Use a JPG, PNG, or WebP photo."),
    );
    expect(classified.code).toBe("MEETUP_COVER_UPLOAD_FAILED");
    expect(classified.field).toBe("cover");
    expect(classified.description).toMatch(/JPG, PNG, or WebP/);
  });

  it("still maps the oversize server rejection separately", () => {
    expect(classifyMeetupPublishError(new Error("Cover image is too large")).code).toBe(
      "MEETUP_COVER_TOO_LARGE",
    );
  });
});

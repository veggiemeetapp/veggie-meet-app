import { describe, expect, it } from "vitest";
import { classifyQrIssue } from "./meetupCheckin";

describe("Meetup QR issue classification", () => {
  it("recognises the server's check-in window states", () => {
    expect(classifyQrIssue("Check-in opens closer to the Meetup.")).toBe("too_early");
    expect(classifyQrIssue("Check-in for this Meetup has ended.")).toBe("closed");
    expect(classifyQrIssue("This Meetup was cancelled.")).toBe("cancelled");
  });

  it("recognises attendance and authentication rejections", () => {
    expect(classifyQrIssue("You must be attending this Meetup to generate a check-in code.")).toBe(
      "not_attending",
    );
    expect(classifyQrIssue("Not authenticated")).toBe("unauthenticated");
  });

  it("keeps unexpected backend failures generic", () => {
    expect(classifyQrIssue("Network request failed")).toBe("unknown");
  });
});

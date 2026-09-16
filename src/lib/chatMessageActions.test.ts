import { describe, expect, it } from "vitest";
import {
  buildForwardedMeetupMessage,
  buildMeetupReplyBody,
  meetupReplyPrefix,
} from "@/lib/chatMessageActions";

describe("Meetup chat message actions", () => {
  it("builds a compact reply quote and keeps the new message on its own line", () => {
    expect(buildMeetupReplyBody("James", "  Who   there? ", "Hello!", 2000)).toBe(
      "↪ Replying to James: “Who there?”\nHello!",
    );
  });

  it("accounts for the quote when enforcing the message limit", () => {
    const prefix = meetupReplyPrefix("James", "Who there?");
    expect(() =>
      buildMeetupReplyBody("James", "Who there?", "x".repeat(21), prefix.length + 20),
    ).toThrow("Messages must be under");
  });

  it("clips a forwarded message to the destination limit", () => {
    const result = buildForwardedMeetupMessage("James", "x".repeat(2000), 2000);
    expect(result).toHaveLength(2000);
    expect(result).toMatch(/^Forwarded from James in a Meetup chat:\n/);
    expect(result.endsWith("…")).toBe(true);
  });
});

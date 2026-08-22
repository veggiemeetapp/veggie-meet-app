import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isStaleClientError, normalizeError } from "@/lib/errors";

/**
 * WO-124F / DEF-124F-01 regression coverage.
 *
 * A pre-WO-124 Host bundle posts `create_hosted_meetup` without the interest
 * arguments; the RPC rejects it before insert with HTTP 400 / SQLSTATE 22023
 * and the product-approved copy. That single response must become an
 * actionable stale-client error, while every other 22023 payload stays
 * sanitized.
 */
const missingInterest = {
  code: "22023",
  message: "Choose what this Meetup is about.",
  details: null,
  hint: null,
};

describe("stale-client missing-interest classification", () => {
  it("classifies the known 22023 missing-interest rejection", () => {
    expect(isStaleClientError(missingInterest)).toBe(true);
    const n = normalizeError(missingInterest);
    expect(n.category).toBe("stale_client");
    expect(n.title).toBe("Choose what this Meetup is about");
    expect(n.description).toMatch(/updated/i);
    expect(n.description).toMatch(/reload/i);
    expect(n.description).toMatch(/nothing was saved/i);
    expect(n.retryable).toBe(false);
  });

  it("is code-scoped: same copy under another code is not stale-client", () => {
    expect(
      isStaleClientError({ code: "P0001", message: "Choose what this Meetup is about." }),
    ).toBe(false);
  });

  it("does not trust arbitrary 22023 messages", () => {
    for (const message of [
      'invalid input syntax for type uuid: "abc"',
      "permission denied for relation meetups",
      "PL/pgSQL function public.create_hosted_meetup(text) line 42",
      "jwt token expired for bearer credential",
      "SELECT * FROM public.meetups WHERE host_id = $$x$$;",
    ]) {
      const err = { code: "22023", message };
      expect(isStaleClientError(err)).toBe(false);
      const n = normalizeError(err);
      expect(n.category).not.toBe("stale_client");
      expect(n.title).not.toContain(message);
    }
  });

  it("keeps existing sanitized fallback copy for unknown 22023 failures", () => {
    const n = normalizeError({ code: "22023", message: "column x does not exist" });
    expect(n.title).toBe("Something went wrong");
    expect(n.description).toBe("Nothing was saved. Please try again.");
  });
});

describe("existing error behaviour is unchanged", () => {
  const originalOnLine = navigator.onLine;
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { value: originalOnLine, configurable: true });
    vi.restoreAllMocks();
  });

  it("still maps capacity, auth, rate limit and raised domain rules", () => {
    expect(normalizeError({ message: "This Meetup is full" }).category).toBe("capacity");
    expect(normalizeError({ status: 401, message: "not authenticated" }).category).toBe(
      "auth_expired",
    );
    expect(normalizeError({ status: 429, message: "too many requests" }).category).toBe(
      "rate_limited",
    );
    expect(
      normalizeError({ code: "P0001", message: "This Meetup is no longer available" }).category,
    ).toBe("domain");
    expect(normalizeError({ message: "Failed to fetch" }).category).toBe("offline");
  });
});

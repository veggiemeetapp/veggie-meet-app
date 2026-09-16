import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOAuthPending,
  hasPendingOAuth,
  markOAuthPending,
  OAUTH_PENDING_TTL_MS,
} from "@/lib/authRedirect";

describe("OAuth round-trip marker", () => {
  beforeEach(() => sessionStorage.clear());

  it("keeps a new OAuth callback pending in the same tab", () => {
    markOAuthPending(1_000);
    expect(hasPendingOAuth(1_001)).toBe(true);
  });

  it("expires abandoned OAuth flows", () => {
    markOAuthPending(1_000);
    expect(hasPendingOAuth(1_000 + OAUTH_PENDING_TTL_MS + 1)).toBe(false);
  });

  it("clears the marker after success or an explicit failure", () => {
    markOAuthPending(1_000);
    clearOAuthPending();
    expect(hasPendingOAuth(1_001)).toBe(false);
  });
});

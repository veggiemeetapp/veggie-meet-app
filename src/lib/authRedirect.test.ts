import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_CALLBACK_PATH,
  clearOAuthPending,
  hasOAuthCallbackError,
  hasPendingOAuth,
  markOAuthPending,
  OAUTH_PENDING_TTL_MS,
  resolvePostAuthDestination,
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

describe("post-auth destination", () => {
  it("defaults to Today and rejects auth-only routes", () => {
    expect(resolvePostAuthDestination(null)).toBe("/");
    expect(resolvePostAuthDestination("/onboarding")).toBe("/");
    expect(resolvePostAuthDestination(AUTH_CALLBACK_PATH)).toBe("/");
    expect(resolvePostAuthDestination("/reset-password")).toBe("/");
  });

  it("preserves a safe private destination", () => {
    expect(resolvePostAuthDestination("/host?draft=1")).toBe("/host?draft=1");
  });

  it("recognizes explicit provider errors in query or hash", () => {
    expect(hasOAuthCallbackError("?error=access_denied", "")).toBe(true);
    expect(hasOAuthCallbackError("", "#error_description=cancelled")).toBe(true);
    expect(hasOAuthCallbackError("?code=ok", "")).toBe(false);
  });
});

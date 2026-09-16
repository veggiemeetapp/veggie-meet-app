import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOAuthPending,
  hasOAuthCallbackError,
  hasPendingOAuth,
  markOAuthPending,
  OAUTH_PENDING_CHANGE_EVENT,
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

  it("notifies the mounted auth provider when pending state changes", () => {
    let changes = 0;
    const listener = () => {
      changes += 1;
    };
    window.addEventListener(OAUTH_PENDING_CHANGE_EVENT, listener);
    markOAuthPending(1_000);
    clearOAuthPending();
    window.removeEventListener(OAUTH_PENDING_CHANGE_EVENT, listener);
    expect(changes).toBe(2);
  });
});

describe("OAuth callback routing", () => {
  it("sends a normal sign-in to Today and preserves valid deep links", () => {
    expect(resolvePostAuthDestination(null)).toBe("/");
    expect(resolvePostAuthDestination("/host?draft=1")).toBe("/host?draft=1");
  });

  it("never sends a successful sign-in back to an auth surface", () => {
    expect(resolvePostAuthDestination("/onboarding")).toBe("/");
    expect(resolvePostAuthDestination("/onboarding?resume=auth")).toBe("/");
    expect(resolvePostAuthDestination("/auth/callback")).toBe("/");
  });

  it("detects provider failures in both callback encodings", () => {
    expect(hasOAuthCallbackError("?error=access_denied", "")).toBe(true);
    expect(
      hasOAuthCallbackError("", "#error_description=The+user+cancelled"),
    ).toBe(true);
    expect(hasOAuthCallbackError("?code=success", "")).toBe(false);
  });
});

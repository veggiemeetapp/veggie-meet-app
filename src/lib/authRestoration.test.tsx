/**
 * WO-145Q CORRECTION — restoration must never fail open to onboarding.
 *
 * These tests hold the state machine and the rendered surface to the corrected
 * contract, including the case the previous closeout contradicted: a persisted
 * session whose refresh is still unresolved after AUTH_HYDRATION_GRACE_MS.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  AUTH_HYDRATION_GRACE_MS,
  classifyAuthGate,
  isRestoringGate,
} from "@/lib/authHydration";
import { AuthRestoring } from "@/components/app/AuthRestoring";

afterEach(() => cleanup());

describe("restoration never renders onboarding", () => {
  it("stays delayed — not signed-out — long past the grace window", () => {
    for (const elapsed of [
      AUTH_HYDRATION_GRACE_MS + 1,
      AUTH_HYDRATION_GRACE_MS * 3,
      10 * 60_000,
    ]) {
      const gate = classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: elapsed > AUTH_HYDRATION_GRACE_MS,
      });
      expect(gate).toBe("delayed");
      expect(isRestoringGate(gate)).toBe(true);
      expect(gate).not.toBe("signed-out");
    }
  });

  it("keeps holding while the provider itself is still initialising", () => {
    expect(
      classifyAuthGate({
        loading: true,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: true,
      }),
    ).toBe("delayed");
  });

  it("offline startup with a persisted session never resolves to signed-out", () => {
    const online = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    try {
      const gate = classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: true,
      });
      expect(gate).toBe("delayed");
      render(<AuthRestoring delayed />);
      expect(screen.getByTestId("auth-restoring-delayed")).toBeTruthy();
      expect(screen.getByText(/offline/i)).toBeTruthy();
      expect(screen.getByText(/still signed in/i)).toBeTruthy();
      // The welcome/auth wording of onboarding must be absent.
      expect(screen.queryByText(/Sign in|Create account|Welcome to VeggieMeet/i)).toBeNull();
    } finally {
      if (online) Object.defineProperty(navigator, "onLine", online);
    }
  });

  it("an explicit sign-out is immediately conclusive even with a token present", () => {
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: false,
        explicitSignOut: true,
      }),
    ).toBe("signed-out");
  });

  it("a settled visitor with nothing persisted reaches onboarding at once", () => {
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: false,
        graceElapsed: false,
      }),
    ).toBe("signed-out");
  });
});

describe("delayed restoration surface", () => {
  it("is honest, offers retry, and never suggests signing out", () => {
    const onRetry = vi.fn();
    render(<AuthRestoring delayed onRetry={onRetry} />);
    const retry = screen.getByRole("button", { name: /try again/i });
    expect(retry).toBeTruthy();
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/sign out|clear data|reinstall/i)).toBeNull();
  });

  it("announces politely while the normal restore runs", () => {
    render(<AuthRestoring />);
    const node = screen.getByTestId("auth-restoring");
    expect(node.getAttribute("aria-live")).toBe("polite");
    expect(node.getAttribute("role")).toBe("status");
  });
});

describe("onboarding analytics stay suppressed throughout restoration", () => {
  it("suppresses the step events for both restoring and delayed", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync("src/screens/Onboarding.tsx", "utf8");
    expect(src).toMatch(
      /if \(authGate === "restoring" \|\| authGate === "delayed"\) return;/,
    );
  });
});

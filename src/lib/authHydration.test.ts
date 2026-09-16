/**
 * WO-145Q — regression cover for the authentication flash observed on the
 * founder's installed iPhone (IMG_0012.MP4, production telemetry 13:34:52Z and
 * 13:35:21Z): the signed-out welcome/auth screens rendered while a valid session
 * was still restoring after a consented update reload.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  AUTH_HYDRATION_GRACE_MS,
  classifyAuthGate,
  hasPersistedAuthToken,
} from "@/lib/authHydration";

function memoryStorage(entries: Record<string, string> = {}) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  };
}

describe("WO-145Q auth hydration gate", () => {
  it("never reports signed-out while initialisation is running", () => {
    expect(
      classifyAuthGate({
        loading: true,
        hasSession: false,
        profileResolved: false,
        persistedToken: false,
        graceElapsed: false,
      }),
    ).toBe("restoring");
  });

  it("holds the restoring state when a persisted session has not resolved yet", () => {
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: false,
      }),
    ).toBe("restoring");
  });

  it("resolves to authenticated the moment the restored session arrives", () => {
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: true,
        profileResolved: true,
        persistedToken: true,
        graceElapsed: false,
      }),
    ).toBe("authenticated");
  });

  it("does not route on a session whose profile has not settled", () => {
    // This is the second flash source: onboarding_completed is unknown, so the
    // onboarding redirect would fire for a fully onboarded member.
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: true,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: false,
      }),
    ).toBe("restoring");
  });

  it("NEVER falls open to onboarding for a persisted session — it reports delayed", () => {
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: true,
      }),
    ).toBe("delayed");
    // And a profile read that never settles still lets the member in.
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: true,
        profileResolved: false,
        persistedToken: true,
        graceElapsed: true,
      }),
    ).toBe("authenticated");
  });

  it("reports signed-out immediately when no token is persisted", () => {
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: false,
        graceElapsed: true,
      }),
    ).toBe("signed-out");
  });

  it("does not route a fresh OAuth callback through onboarding before its session arrives", () => {
    expect(
      classifyAuthGate({
        loading: false,
        hasSession: false,
        profileResolved: false,
        persistedToken: false,
        oauthPending: true,
        graceElapsed: true,
        // getSession can report this intermediate result before the provider
        // response has been exchanged; the explicit OAuth marker wins.
        sessionRejected: true,
      }),
    ).toBe("restoring");
  });

  it("detects a persisted session by key presence only", () => {
    expect(hasPersistedAuthToken(memoryStorage({ "sb-abc-auth-token": "{...}" }))).toBe(true);
    expect(hasPersistedAuthToken(memoryStorage({ "sb-abc-auth-token.0": "{...}" }))).toBe(true);
    expect(hasPersistedAuthToken(memoryStorage({ "sb-abc-auth-token": "" }))).toBe(false);
    expect(hasPersistedAuthToken(memoryStorage({ theme: "dark" }))).toBe(false);
    expect(hasPersistedAuthToken(null, undefined)).toBe(false);
  });

  it("degrades silently when storage throws", () => {
    const hostile = {
      length: 1,
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => null,
    };
    expect(hasPersistedAuthToken(hostile)).toBe(false);
  });

  it("keeps the restore window generous enough for a cold mobile start", () => {
    // The founder's real restore completed ~43s after the unauthenticated render
    // on a cold network; the window must at least cover a normal cold restore.
    expect(AUTH_HYDRATION_GRACE_MS).toBeGreaterThanOrEqual(10_000);
    expect(AUTH_HYDRATION_GRACE_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("WO-145Q route gates consume the gate, not raw loading", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const onboarding = readFileSync("src/screens/Onboarding.tsx", "utf8");
  const auth = readFileSync("src/hooks/useAuth.tsx", "utf8");

  it("renders an authenticated loading state instead of a blank document", () => {
    expect(app).toMatch(/authGate === "restoring" \|\| authGate === "delayed"/);
    expect(app).not.toMatch(/if \(loading\) return null;/);
  });

  it("never renders the welcome/auth experience while restoring", () => {
    expect(onboarding).toMatch(/authGate === "restoring" \|\| authGate === "delayed"/);
    expect(onboarding).toMatch(/<AuthRestoring/);
  });

  it("treats an explicit sign-out as conclusive", () => {
    expect(auth).toMatch(/setPersistedToken\(false\)/);
    expect(auth).toMatch(/setExplicitSignOut\(true\)/);
  });

  it("renders the branded restoration state for delayed restoration too", () => {
    expect(app).toMatch(/authGate === "delayed"/);
    expect(onboarding).toMatch(/authGate === "delayed"/);
  });

  it("introduces no sign-out, unregister or clientsClaim", () => {
    for (const src of [app, onboarding, auth]) {
      expect(src).not.toMatch(/clientsClaim|registration\.unregister/);
    }
  });
});

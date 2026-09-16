/**
 * WO-107 / DEF-107-01 — the app's authentication surfaces must always resolve
 * to the *current* production origin (https://veggiemeet.app) and must never
 * hardcode the retired Lovable hostname as the member-facing identity.
 *
 * These are static-source assertions on purpose: the Google-hosted consent
 * screen cannot (and must not) be asserted from a test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { sanitizeInternalPath } from "@/lib/authRedirect";

const LEGACY_HOST = "veggie-meet-app.lovable.app";
const onboarding = readFileSync("src/screens/Onboarding.tsx", "utf8");
const authProvider = readFileSync("src/hooks/useAuth.tsx", "utf8");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) acc.push(p);
  }
  return acc;
}

describe("Google OAuth production identity", () => {
  it("requests Google sign-in through the managed Lovable auth helper", () => {
    expect(onboarding).toContain('lovable.auth.signInWithOAuth("google"');
  });

  it("uses the current browser origin as the application redirect destination", () => {
    expect(onboarding).toMatch(/redirect_uri:\s*window\.location\.origin/);
  });

  it("marks the origin callback as pending before starting the provider redirect", () => {
    expect(onboarding).toMatch(
      /markOAuthPending\(\);[\s\S]*lovable\.auth\.signInWithOAuth\("google"/,
    );
    expect(authProvider).toMatch(/oauthPending[\s\S]*classifyAuthGate/);
  });

  it("never points the OAuth redirect at an unrelated private screen", () => {
    expect(onboarding).not.toMatch(/redirect_uri:\s*`?\$?\{?window\.location\.origin\}?\/(today|you|network)/);
  });

  it("keeps email confirmation and password reset on the current origin", () => {
    expect(onboarding).toMatch(/emailRedirectTo:\s*`\$\{window\.location\.origin\}\//);
    expect(onboarding).toMatch(/redirectTo:\s*`\$\{window\.location\.origin\}\/reset-password`/);
  });

  it("does not hardcode the retired Lovable hostname anywhere in app source", () => {
    const offenders = sourceFiles("src").filter((f) =>
      readFileSync(f, "utf8").includes(LEGACY_HOST),
    );
    expect(offenders).toEqual([]);
  });
});

describe("post-auth redirect safety (no open redirect)", () => {
  it("accepts same-origin relative destinations", () => {
    expect(sanitizeInternalPath("/network")).toBe("/network");
  });

  it("rejects external origins including the legacy host", () => {
    for (const bad of [
      `https://${LEGACY_HOST}/today`,
      "https://evil.test/",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
    ]) {
      expect(sanitizeInternalPath(bad)).toBeNull();
    }
  });
});

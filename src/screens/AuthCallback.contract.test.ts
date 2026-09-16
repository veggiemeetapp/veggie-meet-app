import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const onboarding = readFileSync("src/screens/Onboarding.tsx", "utf8");
const callback = readFileSync("src/screens/AuthCallback.tsx", "utf8");

describe("authentication outcome routing", () => {
  it("uses a dedicated public provider callback", () => {
    expect(app).toContain('path="/auth/callback" element={<AuthCallback />}');
    expect(onboarding).toContain(
      'redirect_uri: `${window.location.origin}${AUTH_CALLBACK_PATH}`',
    );
  });

  it("enters the app after a real session and returns failures to auth", () => {
    expect(callback).toContain("if (next) finishSuccess()");
    expect(callback).toContain(
      'const AUTH_FAILURE_PATH = "/onboarding?resume=auth&auth_error=oauth"',
    );
    expect(callback).toContain("navigate(destination, { replace: true })");
    expect(callback).toContain("navigate(AUTH_FAILURE_PATH, { replace: true })");
  });

  it("does not consume the OAuth destination while rendering onboarding", () => {
    expect(onboarding).not.toMatch(
      /sanitizeInternalPath\(searchParams\.get\("next"\)\)\s*\?\?\s*consumePostAuthPath/,
    );
  });
});

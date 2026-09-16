import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const callback = readFileSync("src/screens/AuthCallback.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

describe("OAuth callback routing contract", () => {
  it("is a public route, outside RequireOnboarded", () => {
    expect(app).toContain('<Route path="/auth/callback" element={<AuthCallback />} />');
    expect(app).not.toContain('path="/auth/callback" element={gated(');
  });

  it("enters the app only after Supabase exposes a real session", () => {
    expect(callback).toMatch(/if \(next\) finishSuccess\(\)/);
    expect(callback).toMatch(/if \(session\) \{[\s\S]*finishSuccess\(\)/);
  });

  it("does not turn an arbitrary elapsed timeout into an auth failure", () => {
    expect(callback).not.toMatch(/CALLBACK_SETTLE_MS|setTimeout\(finishFailure/);
    expect(callback).toMatch(/event === "INITIAL_SESSION"/);
  });

  it("returns only settled failures to the auth surface", () => {
    expect(callback).toContain(
      'const AUTH_FAILURE_PATH = "/onboarding?resume=auth&auth_error=oauth"',
    );
    expect(callback).toMatch(/if \(callbackHasError\)[\s\S]*finishFailure\(\)/);
  });
});

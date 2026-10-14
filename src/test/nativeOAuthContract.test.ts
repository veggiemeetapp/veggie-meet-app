import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

describe("native OAuth integration contract", () => {
  it("registers and mounts the native callback bridge", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const plist = readFileSync("ios/App/App/Info.plist", "utf8");

    expect(app).toContain("<NativeAuthBridge />");
    expect(plist).toContain("<string>app.veggiemeet.ios</string>");
  });

  it("uses PKCE only on native while retaining the web flow", () => {
    const client = readFileSync("src/integrations/supabase/client.ts", "utf8");
    const onboarding = readFileSync("src/screens/Onboarding.tsx", "utf8");

    expect(client).toContain("flowType: isNativePlatform ? 'pkce' : 'implicit'");
    expect(client).toContain("detectSessionInUrl: !isNativePlatform");
    expect(onboarding).toContain("startNativeGoogleSignIn()");
    expect(onboarding).toContain('lovable.auth.signInWithOAuth("google"');
  });
});


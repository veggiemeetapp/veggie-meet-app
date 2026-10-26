import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  authorize: vi.fn(),
  signInWithIdToken: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
  registerPlugin: () => ({ authorize: mocks.authorize }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithIdToken: mocks.signInWithIdToken } },
}));

import { startNativeAppleSignIn } from "@/lib/nativeAppleAuth";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("native Apple sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.authorize.mockResolvedValue({ identityToken: "id-token", user: "001234" });
    mocks.signInWithIdToken.mockResolvedValue({ data: { session: {} }, error: null });
  });

  it("hands Apple the hashed nonce and Supabase the raw one", async () => {
    const result = await startNativeAppleSignIn();

    expect(result).toEqual({ error: null, canceled: false });
    const hashed = mocks.authorize.mock.calls[0][0].nonce;
    const raw = mocks.signInWithIdToken.mock.calls[0][0].nonce;
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).toBe(await sha256Hex(raw));
    expect(mocks.signInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "id-token",
      nonce: raw,
    });
  });

  it("treats the dismissed system sheet as a cancellation, not an error", async () => {
    mocks.authorize.mockRejectedValue({ code: "canceled", message: "canceled" });

    const result = await startNativeAppleSignIn();

    expect(result).toEqual({ error: null, canceled: true });
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("surfaces Supabase rejections", async () => {
    const rejection = new Error("Invalid audience");
    mocks.signInWithIdToken.mockResolvedValue({ data: { session: null }, error: rejection });

    const result = await startNativeAppleSignIn();

    expect(result).toEqual({ error: rejection, canceled: false });
  });

  it("leaves the web flow to the browser implementation", async () => {
    mocks.isNativePlatform.mockReturnValue(false);

    const result = await startNativeAppleSignIn();

    expect(result.error).toBeInstanceOf(Error);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});

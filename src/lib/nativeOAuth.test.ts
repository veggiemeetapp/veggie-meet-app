import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  browserOpen: vi.fn(),
  browserClose: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(),
    getLaunchUrl: vi.fn(),
  },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: mocks.browserOpen,
    close: mocks.browserClose,
    addListener: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOAuth: mocks.signInWithOAuth,
      exchangeCodeForSession: mocks.exchangeCodeForSession,
    },
  },
}));

import {
  NATIVE_AUTH_CALLBACK_URL,
  completeNativeGoogleSignIn,
  parseNativeOAuthCallback,
  startNativeGoogleSignIn,
} from "@/lib/nativeOAuth";

describe("native Google OAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.browserOpen.mockResolvedValue(undefined);
    mocks.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: "https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/authorize",
        flowId: "flow-1",
      },
      error: null,
    });
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: "test" } },
      error: null,
    });
  });

  it("accepts only the registered VeggieMeet callback", () => {
    expect(parseNativeOAuthCallback(`${NATIVE_AUTH_CALLBACK_URL}?code=one`)).toEqual({
      kind: "success",
      code: "one",
      flowId: undefined,
    });
    expect(parseNativeOAuthCallback("https://veggiemeet.app/auth/callback?code=one")).toBeNull();
    expect(parseNativeOAuthCallback("app.veggiemeet.ios://other/callback?code=one")).toBeNull();
  });

  it("opens the Supabase Google URL in the native system browser", async () => {
    const result = await startNativeGoogleSignIn();

    expect(result.error).toBeNull();
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: NATIVE_AUTH_CALLBACK_URL,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    expect(mocks.browserOpen).toHaveBeenCalledWith({
      url: "https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/authorize",
      presentationStyle: "fullscreen",
    });
  });

  it("exchanges the callback code with the stored PKCE flow id", async () => {
    await startNativeGoogleSignIn();
    const result = await completeNativeGoogleSignIn(
      `${NATIVE_AUTH_CALLBACK_URL}?code=authorization-code`,
    );

    expect(result.error).toBeNull();
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith(
      "authorization-code",
      { flowId: "flow-1" },
    );
  });

  it("does not exchange an explicit provider error", async () => {
    const result = await completeNativeGoogleSignIn(
      `${NATIVE_AUTH_CALLBACK_URL}?error=access_denied`,
    );

    expect(result.error).toBeInstanceOf(Error);
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("leaves the existing web flow to the browser implementation", async () => {
    mocks.isNativePlatform.mockReturnValue(false);

    const result = await startNativeGoogleSignIn();

    expect(result.error).toBeInstanceOf(Error);
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
    expect(mocks.browserOpen).not.toHaveBeenCalled();
  });
});


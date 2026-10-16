import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

type UrlListener = (event: { url: string }) => void;

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  urlListeners: [] as UrlListener[],
  getLaunchUrl: vi.fn<() => Promise<{ url: string } | null>>(),
  browserClose: vi.fn(),
  completeNativeGoogleSignIn: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

vi.mock("@/lib/nativeOAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nativeOAuth")>("@/lib/nativeOAuth");
  return {
    ...actual,
    completeNativeGoogleSignIn: mocks.completeNativeGoogleSignIn,
    closeNativeAuthBrowser: mocks.browserClose,
    nativeAuthApp: {
      addListener: vi.fn(async (_event: string, listener: UrlListener) => {
        mocks.urlListeners.push(listener);
        return { remove: vi.fn() };
      }),
      getLaunchUrl: mocks.getLaunchUrl,
    },
    nativeAuthBrowser: {
      addListener: vi.fn(async () => ({ remove: vi.fn() })),
    },
  };
});

vi.mock("@capacitor/app", () => ({ App: {} }));
vi.mock("@capacitor/browser", () => ({ Browser: {} }));

import { NativeAuthBridge, resetNativeAuthBridgeStateForTests } from "./NativeAuthBridge";
import { NATIVE_AUTH_CALLBACK_URL } from "@/lib/nativeOAuth";

const CALLBACK = `${NATIVE_AUTH_CALLBACK_URL}?code=one-time-code`;

function Location() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{pathname + search}</p>;
}

function Harness() {
  return (
    <MemoryRouter initialEntries={["/onboarding"]}>
      <NativeAuthBridge />
      <Routes>
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>
  );
}

async function deliverDeepLink(url: string) {
  await waitFor(() => expect(mocks.urlListeners.length).toBeGreaterThan(0));
  await act(async () => {
    for (const listener of [...mocks.urlListeners]) listener({ url });
  });
}

describe("NativeAuthBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.urlListeners.length = 0;
    resetNativeAuthBridgeStateForTests();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getLaunchUrl.mockResolvedValue(null);
    mocks.browserClose.mockResolvedValue(undefined);
    mocks.completeNativeGoogleSignIn.mockResolvedValue({ error: null });
    sessionStorage.clear();
  });

  it("exchanges a callback once and enters the app", async () => {
    render(<Harness />);
    await deliverDeepLink(CALLBACK);

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/"));
    expect(mocks.completeNativeGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(mocks.browserClose).toHaveBeenCalledTimes(1);
  });

  it("does not re-check the retained launch URL after a route change", async () => {
    mocks.getLaunchUrl.mockResolvedValue({ url: CALLBACK });
    render(<Harness />);

    // Cold launch: the launch URL is consumed and navigation to "/" happens,
    // which hands the bridge a new `navigate` identity.
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/"));
    await waitFor(() => expect(mocks.completeNativeGoogleSignIn).toHaveBeenCalledTimes(1));

    // Any later deliveries of the same URL (retained event, repeated launch
    // URL reads) must be ignored instead of replaying a consumed PKCE code.
    await deliverDeepLink(CALLBACK);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocks.getLaunchUrl).toHaveBeenCalledTimes(1);
    expect(mocks.completeNativeGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/");
    expect(screen.getByTestId("location")).not.toHaveTextContent("auth_error");
  });

  it("routes a failed exchange to the auth step exactly once", async () => {
    mocks.completeNativeGoogleSignIn.mockResolvedValue({ error: new Error("nope") });
    render(<Harness />);
    await deliverDeepLink(CALLBACK);

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/onboarding?resume=auth&auth_error=oauth",
      ),
    );
    await deliverDeepLink(CALLBACK);
    expect(mocks.completeNativeGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it("still handles a genuinely new callback after an earlier one", async () => {
    render(<Harness />);
    await deliverDeepLink(CALLBACK);
    await waitFor(() => expect(mocks.completeNativeGoogleSignIn).toHaveBeenCalledTimes(1));

    await deliverDeepLink(`${NATIVE_AUTH_CALLBACK_URL}?code=second-code`);
    await waitFor(() => expect(mocks.completeNativeGoogleSignIn).toHaveBeenCalledTimes(2));
  });

  it("is inert on the web", async () => {
    mocks.isNativePlatform.mockReturnValue(false);
    render(<Harness />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.urlListeners).toHaveLength(0);
    expect(mocks.getLaunchUrl).not.toHaveBeenCalled();
  });
});

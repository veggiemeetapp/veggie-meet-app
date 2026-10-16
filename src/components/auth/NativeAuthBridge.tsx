import { useEffect, useRef } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import {
  clearOAuthPending,
  consumePostAuthPath,
  resolvePostAuthDestination,
} from "@/lib/authRedirect";
import {
  closeNativeAuthBrowser,
  completeNativeGoogleSignIn,
  nativeAuthApp,
  nativeAuthBrowser,
  parseNativeOAuthCallback,
} from "@/lib/nativeOAuth";

const AUTH_FAILURE_PATH = "/onboarding?resume=auth&auth_error=oauth";

/**
 * Process-lifetime state, deliberately outside React.
 *
 * Capacitor keeps the most recent deep link in `App.getLaunchUrl()` for as long
 * as the process lives, and iOS can deliver a cold-launch URL through both
 * `getLaunchUrl()` and a retained `appUrlOpen` event. A PKCE code is single-use,
 * so the same callback URL must be exchanged exactly once no matter how many
 * times it is observed or how often this component re-renders.
 */
let launchUrlChecked = false;
const handledCallbackUrls = new Set<string>();

/** Test-only: forget process-lifetime state between cases. */
export function resetNativeAuthBridgeStateForTests(): void {
  launchUrlChecked = false;
  handledCallbackUrls.clear();
}

/** Owns the native deep-link lifecycle without changing the browser OAuth flow. */
export function NativeAuthBridge() {
  const navigate = useNavigate();
  // `useNavigate` returns a new function on every pathname change. Reading it
  // through a ref keeps the effect below mounted once instead of re-running
  // (and re-checking the launch URL) after every route transition.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const handlingCallbackRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let active = true;
    const handles: PluginListenerHandle[] = [];

    const handleCallback = async (url: string) => {
      if (!active || handlingCallbackRef.current || !parseNativeOAuthCallback(url)) return;
      if (handledCallbackUrls.has(url)) return;
      handledCallbackUrls.add(url);
      handlingCallbackRef.current = true;
      await closeNativeAuthBrowser();

      try {
        const result = await completeNativeGoogleSignIn(url);
        if (!active) return;

        if (result.error) {
          consumePostAuthPath();
          clearOAuthPending();
          navigateRef.current(AUTH_FAILURE_PATH, { replace: true });
          return;
        }

        const destination = resolvePostAuthDestination(consumePostAuthPath());
        clearOAuthPending();
        navigateRef.current(destination, { replace: true });
      } finally {
        handlingCallbackRef.current = false;
      }
    };

    void nativeAuthApp
      .addListener("appUrlOpen", ({ url }) => void handleCallback(url))
      .then((handle) => {
        if (active) handles.push(handle);
        else void handle.remove();
      });

    void nativeAuthBrowser
      .addListener("browserFinished", () => {
        if (!handlingCallbackRef.current) clearOAuthPending();
      })
      .then((handle) => {
        if (active) handles.push(handle);
        else void handle.remove();
      });

    // Covers an OAuth callback that cold-launched the app rather than resuming
    // it. Checked once per process: the value never clears, so a later check
    // would replay an already-consumed callback.
    if (!launchUrlChecked) {
      launchUrlChecked = true;
      void nativeAuthApp.getLaunchUrl().then((launch) => {
        if (launch?.url) void handleCallback(launch.url);
      });
    }

    return () => {
      active = false;
      for (const handle of handles) void handle.remove();
    };
  }, []);

  return null;
}

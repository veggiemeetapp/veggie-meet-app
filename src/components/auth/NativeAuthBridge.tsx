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

/** Owns the native deep-link lifecycle without changing the browser OAuth flow. */
export function NativeAuthBridge() {
  const navigate = useNavigate();
  const handlingCallbackRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let active = true;
    const handles: PluginListenerHandle[] = [];

    const handleCallback = async (url: string) => {
      if (!active || handlingCallbackRef.current || !parseNativeOAuthCallback(url)) return;
      handlingCallbackRef.current = true;
      await closeNativeAuthBrowser();

      try {
        const result = await completeNativeGoogleSignIn(url);
        if (!active) return;

        if (result.error) {
          consumePostAuthPath();
          clearOAuthPending();
          navigate(AUTH_FAILURE_PATH, { replace: true });
          return;
        }

        const destination = resolvePostAuthDestination(consumePostAuthPath());
        clearOAuthPending();
        navigate(destination, { replace: true });
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

    // Covers an OAuth callback that cold-launched the app rather than resuming it.
    void nativeAuthApp.getLaunchUrl().then((launch) => {
      if (launch?.url) void handleCallback(launch.url);
    });

    return () => {
      active = false;
      for (const handle of handles) void handle.remove();
    };
  }, [navigate]);

  return null;
}


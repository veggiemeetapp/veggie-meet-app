import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export const NATIVE_AUTH_CALLBACK_URL = "app.veggiemeet.ios://auth/callback";

const NATIVE_AUTH_SCHEME = "app.veggiemeet.ios:";
const NATIVE_AUTH_HOST = "auth";
const NATIVE_AUTH_PATH = "/callback";
const NATIVE_OAUTH_FLOW_ID_KEY = "veggiemeet_native_oauth_flow_id";

type NativeOAuthCallback =
  | { kind: "success"; code: string; flowId?: string }
  | { kind: "error" }
  | null;

export type NativeOAuthResult = { error: Error | null };

function callbackParameters(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}

/**
 * Accept only the callback owned by this app. Other deep links must remain
 * available for their own feature-specific routing.
 */
export function parseNativeOAuthCallback(rawUrl: string): NativeOAuthCallback {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== NATIVE_AUTH_SCHEME ||
      url.hostname !== NATIVE_AUTH_HOST ||
      url.pathname !== NATIVE_AUTH_PATH
    ) {
      return null;
    }

    const params = callbackParameters(url);
    if (
      params.has("error") ||
      params.has("error_code") ||
      params.has("error_description")
    ) {
      return { kind: "error" };
    }

    const code = params.get("code");
    if (!code) return { kind: "error" };
    const flowId = params.get("sb_flow_id") ?? undefined;
    return { kind: "success", code, flowId };
  } catch {
    return null;
  }
}

function storeFlowId(flowId: string | null | undefined): void {
  try {
    if (flowId) localStorage.setItem(NATIVE_OAUTH_FLOW_ID_KEY, flowId);
    else localStorage.removeItem(NATIVE_OAUTH_FLOW_ID_KEY);
  } catch {
    /* The code exchange can still use Supabase's latest stored verifier. */
  }
}

function consumeFlowId(callbackFlowId?: string): string | undefined {
  try {
    const flowId = callbackFlowId ?? localStorage.getItem(NATIVE_OAUTH_FLOW_ID_KEY) ?? undefined;
    localStorage.removeItem(NATIVE_OAUTH_FLOW_ID_KEY);
    return flowId;
  } catch {
    return callbackFlowId;
  }
}

/** Start the native-only Google PKCE flow in iOS's system browser surface. */
export async function startNativeGoogleSignIn(): Promise<NativeOAuthResult> {
  if (!Capacitor.isNativePlatform()) {
    return { error: new Error("Native Google sign-in is unavailable on the web.") };
  }

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: NATIVE_AUTH_CALLBACK_URL,
        skipBrowserRedirect: true,
      },
    });

    if (error) return { error };
    if (!data.url) return { error: new Error("Google sign-in URL was not returned.") };

    storeFlowId(data.flowId);
    await Browser.open({
      url: data.url,
      presentationStyle: "fullscreen",
    });
    return { error: null };
  } catch (error) {
    storeFlowId(null);
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Exchange the one-time PKCE code delivered by the registered iOS deep link. */
export async function completeNativeGoogleSignIn(rawUrl: string): Promise<NativeOAuthResult> {
  const callback = parseNativeOAuthCallback(rawUrl);
  if (!callback) return { error: new Error("This URL is not a VeggieMeet auth callback.") };
  if (callback.kind === "error") {
    consumeFlowId();
    return { error: new Error("Google sign-in was not completed.") };
  }

  const flowId = consumeFlowId(callback.flowId);
  const { error } = await supabase.auth.exchangeCodeForSession(
    callback.code,
    flowId ? { flowId } : undefined,
  );
  return { error: error ?? null };
}

export async function closeNativeAuthBrowser(): Promise<void> {
  try {
    await Browser.close();
  } catch {
    // The browser may already be closing because iOS activated the app.
  }
}

export const nativeAuthApp = App;
export const nativeAuthBrowser = Browser;


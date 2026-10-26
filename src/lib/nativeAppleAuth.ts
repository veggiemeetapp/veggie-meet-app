import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

/** Shape of the `AppleSignIn` plugin implemented in `ios/App/App/AppleSignInPlugin.swift`. */
export interface AppleSignInPlugin {
  authorize(options: { nonce: string }): Promise<{
    identityToken: string;
    user: string;
    email?: string;
    givenName?: string;
    familyName?: string;
  }>;
}

export const AppleSignIn = registerPlugin<AppleSignInPlugin>("AppleSignIn");

export type NativeAppleResult = { error: Error | null; canceled: boolean };

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "canceled" || message === "canceled";
}

/**
 * Native Sign in with Apple: the system sheet returns an identity token whose
 * nonce claim is the SHA-256 of the raw nonce handed to Supabase, which is how
 * Supabase proves the token was minted for this request.
 */
export async function startNativeAppleSignIn(): Promise<NativeAppleResult> {
  if (!Capacitor.isNativePlatform()) {
    return { error: new Error("Native Apple sign-in is unavailable on the web."), canceled: false };
  }

  const nonce = randomNonce();
  let identityToken: string;
  try {
    const result = await AppleSignIn.authorize({ nonce: await sha256Hex(nonce) });
    identityToken = result.identityToken;
  } catch (error) {
    if (isCancellation(error)) return { error: null, canceled: true };
    return { error: error instanceof Error ? error : new Error(String(error)), canceled: false };
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: identityToken,
    nonce,
  });
  return { error: error ?? null, canceled: false };
}

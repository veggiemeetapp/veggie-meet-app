import { supabase } from "@/integrations/supabase/client";
import { logOnboardingEvent } from "@/lib/onboarding";

export type PermissionResult = "granted" | "denied" | "dismissed" | "unsupported";
export type PermissionKind = "notification" | "location";

const LS_PREFIX = "veggiemeet_perm_";
export const permKey = (k: PermissionKind) => `${LS_PREFIX}${k}`;

export function getStoredPermission(k: PermissionKind): PermissionResult | null {
  try {
    return (localStorage.getItem(permKey(k)) as PermissionResult | null) ?? null;
  } catch {
    return null;
  }
}

export function setStoredPermission(k: PermissionKind, r: PermissionResult) {
  try {
    localStorage.setItem(permKey(k), r);
  } catch {
    /* ignore */
  }
}

export async function recordPermissionResult(kind: PermissionKind, result: PermissionResult) {
  setStoredPermission(kind, result);
  logOnboardingEvent(`${kind}_permission_result`, { result });
  try {
    await (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ error: unknown }>)
      .call(supabase, "record_permission_result", { _kind: kind, _result: result });
  } catch {
    /* non-blocking */
  }
}

export async function requestNotificationPermission(): Promise<PermissionResult> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    await recordPermissionResult("notification", "unsupported");
    return "unsupported";
  }
  const existing = Notification.permission;
  if (existing === "granted" || existing === "denied") {
    const r: PermissionResult = existing;
    await recordPermissionResult("notification", r);
    return r;
  }
  try {
    const r = await Notification.requestPermission();
    const mapped: PermissionResult = r === "default" ? "dismissed" : (r as PermissionResult);
    await recordPermissionResult("notification", mapped);
    return mapped;
  } catch {
    await recordPermissionResult("notification", "dismissed");
    return "dismissed";
  }
}

export async function requestLocationPermission(): Promise<PermissionResult> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    await recordPermissionResult("location", "unsupported");
    return "unsupported";
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async () => {
        // We intentionally discard the coordinates — no persistent history.
        await recordPermissionResult("location", "granted");
        resolve("granted");
      },
      async (err) => {
        const r: PermissionResult = err.code === err.PERMISSION_DENIED ? "denied" : "dismissed";
        await recordPermissionResult("location", r);
        resolve(r);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

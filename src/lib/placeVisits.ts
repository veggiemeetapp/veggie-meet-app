import { supabase } from "@/integrations/supabase/client";

/**
 * WO-046 — Community Place verified visits.
 *
 * Privacy: the browser position is read once, passed straight to the
 * server-authoritative RPC, and never stored client-side. The server stores
 * only the calculated distance, the reported accuracy, the result and a
 * timestamp — never raw coordinates.
 */

export type CheckInReason =
  | "success"
  | "location_permission_denied"
  | "location_unavailable"
  | "location_timeout"
  | "location_unsupported"
  | "accuracy_too_low"
  | "outside_radius"
  | "already_checked_in"
  | "cooldown_active"
  | "place_unavailable"
  | "not_authenticated";

export interface CheckInResult {
  ok: boolean;
  reason: CheckInReason;
  placeName?: string;
  isFirstVisitToPlace?: boolean;
  distinctPlacesSupported?: number;
  cooldownUntil?: string | null;
}

export interface PlaceCheckInState {
  checkedIn: boolean;
  everVisited: boolean;
  cooldownUntil: string | null;
}

export async function fetchPlaceCheckInState(
  placeId: string,
): Promise<PlaceCheckInState> {
  const { data, error } = await (supabase.rpc as any)(
    "get_my_place_check_in_state",
    { _place_id: placeId },
  );
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    checkedIn: !!d.checked_in,
    everVisited: !!d.ever_visited,
    cooldownUntil: (d.cooldown_until as string) ?? null,
  };
}

/** Read the device position once. Never persisted. */
function readPosition(): Promise<GeolocationPosition | CheckInReason> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve("location_unsupported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve("location_permission_denied");
        else if (err.code === err.TIMEOUT) resolve("location_timeout");
        else resolve("location_unavailable");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

export async function checkInToCommunityPlace(
  placeId: string,
): Promise<CheckInResult> {
  const pos = await readPosition();
  if (typeof pos === "string") return { ok: false, reason: pos };

  const { data, error } = await (supabase.rpc as any)(
    "check_in_to_community_place",
    {
      _place_id: placeId,
      _latitude: pos.coords.latitude,
      _longitude: pos.coords.longitude,
      _accuracy: pos.coords.accuracy,
    },
  );
  if (error) return { ok: false, reason: "location_unavailable" };

  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: !!d.ok,
    reason: (d.reason as CheckInReason) ?? "location_unavailable",
    placeName: d.place_name as string | undefined,
    isFirstVisitToPlace: d.is_first_visit_to_place as boolean | undefined,
    distinctPlacesSupported: d.distinct_places_supported as number | undefined,
    cooldownUntil: (d.cooldown_until as string) ?? null,
  };
}

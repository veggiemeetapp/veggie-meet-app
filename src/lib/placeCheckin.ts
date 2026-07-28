import { supabase } from "@/integrations/supabase/client";
import { communityPlaces } from "@/lib/mock-data";
import { decodeCheckInPayload } from "@/lib/checkin";
import type { CommunityPlace } from "@/types";

/** QR payload format for a Community Place: `veggiemeet:place:v1:<placeId>` */
const PLACE_PREFIX = "veggiemeet:place:v1:";

export function encodePlaceQRPayload(placeId: string) {
  return `${PLACE_PREFIX}${placeId}`;
}

export function decodePlaceQRPayload(raw: string): { placeId: string } | null {
  if (!raw?.startsWith(PLACE_PREFIX)) return null;
  const placeId = raw.slice(PLACE_PREFIX.length).trim();
  if (!placeId) return null;
  return { placeId };
}

export function getCommunityPlace(id: string): CommunityPlace | undefined {
  return communityPlaces.find((p) => p.id === id);
}

export type PlaceCheckInResult =
  | { kind: "invalid" }
  | { kind: "veggie_qr"; meetupId: string }
  | { kind: "wrong_place" }
  | { kind: "unknown_place" }
  | { kind: "already_today" }
  | { kind: "success" };

function today() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Handle a Community Place QR scan.
 * `expectedPlaceId` is the place the user is currently trying to support.
 */
export async function submitPlaceCheckIn(params: {
  profileId: string;
  expectedPlaceId: string;
  scannedPayload: string;
}): Promise<PlaceCheckInResult> {
  // First: is it a Veggie Check-In QR? If so, route the user there.
  const veggie = decodeCheckInPayload(params.scannedPayload);
  if (veggie) return { kind: "veggie_qr", meetupId: veggie.meetupId };

  const decoded = decodePlaceQRPayload(params.scannedPayload);
  if (!decoded) return { kind: "invalid" };

  if (decoded.placeId !== params.expectedPlaceId) {
    // Still a valid VeggieMeet Community Place QR — just not this one.
    return getCommunityPlace(decoded.placeId) ? { kind: "wrong_place" } : { kind: "unknown_place" };
  }
  if (!getCommunityPlace(decoded.placeId)) return { kind: "unknown_place" };

  const { error } = await supabase.from("place_check_ins").insert({
    profile_id: params.profileId,
    community_place_id: decoded.placeId,
    checked_in_on: today(),
  });

  if (error) {
    // Unique constraint on (profile_id, place_id, day) → already checked in today.
    if ((error as any).code === "23505") return { kind: "already_today" };
    console.error("[place check-in] insert failed", error);
    return { kind: "invalid" };
  }
  // First meaningful action is recorded server-side via trg_activation_place_checkin.
  return { kind: "success" };
}

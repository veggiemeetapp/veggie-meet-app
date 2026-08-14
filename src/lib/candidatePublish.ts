import type { GoogleCandidate, PlaceCandidate } from "@/lib/placeVerification";

/**
 * WO-103 — owner-facing publish gate mirror.
 *
 * The server (`publish_place_candidate()`) remains the source of truth and still
 * requires coordinates, a verified address and Google identity fields. This
 * helper only decides how those requirements are *worded* for the owner: all
 * missing Google-managed verification data collapses into ONE blocker, because
 * the owner is never expected to supply coordinates by hand — confirming the
 * correct Google result supplies them.
 */

export const GOOGLE_VERIFICATION_BLOCKER =
  "Verify this business with Google Places before publishing.";

export const INCOMPLETE_GOOGLE_RESULT_MESSAGE =
  "We couldn’t verify all location details for this business. Try another Google result or search again.";

/** Google-managed fields that a confirmed result writes. Never curated copy. */
export interface GoogleIdentityPatch {
  google_place_id: string;
  google_display_name: string | null;
  google_formatted_address: string;
  google_primary_type: string | null;
  google_maps_url: string | null;
  google_website_url: string | null;
  business_status: string | null;
  latitude: number;
  longitude: number;
}

/** Does the candidate carry a complete, system-supplied Google identity? */
export function hasGoogleVerification(c: Partial<PlaceCandidate>): boolean {
  return (
    !!c.google_place_id &&
    !!c.google_formatted_address &&
    typeof c.latitude === "number" &&
    typeof c.longitude === "number"
  );
}

/**
 * A Google result is only usable when it carries every field the publish gate
 * needs. Anything less must not be treated as verified.
 */
export function toGoogleIdentityPatch(g: GoogleCandidate): GoogleIdentityPatch | null {
  if (
    !g.place_id ||
    !g.formatted_address ||
    typeof g.latitude !== "number" ||
    typeof g.longitude !== "number" ||
    Number.isNaN(g.latitude) ||
    Number.isNaN(g.longitude) ||
    Math.abs(g.latitude) > 90 ||
    Math.abs(g.longitude) > 180
  ) {
    return null;
  }
  return {
    google_place_id: g.place_id,
    google_display_name: g.display_name,
    google_formatted_address: g.formatted_address,
    google_primary_type: g.primary_type,
    google_maps_url: g.google_maps_url,
    google_website_url: g.website_url,
    business_status: g.business_status,
    latitude: g.latitude,
    longitude: g.longitude,
  };
}

/**
 * WO-104 — map server lifecycle errors to owner-safe copy. Raw Postgres detail
 * (permission denied, function names, SQLSTATE) is never shown to the owner.
 */
export function mapLifecycleError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("permission denied"))
    return "Only the VeggieMeet owner can verify and publish places.";
  if (m.includes("already published") || m.includes("already been published"))
    return "This place has already been published.";
  if (m.includes("google place is already") || m.includes("google place id"))
    return "This Google Place is already represented in Community Places.";
  if (m.includes("name and address"))
    return "A published place already uses this name and address.";
  if (m.includes("not operational") || m.includes("permanently closed"))
    return "Google reports this business is not operational.";
  if (m.includes("rejected"))
    return "This candidate was rejected and cannot be published.";
  if (m.includes("missing required verification") || m.includes("required"))
    return "Candidate is missing required verification details.";
  if (m.includes("not found")) return "This candidate could no longer be found.";
  if (m.includes("image rights"))
    return "Image rights must be classified before publishing.";
  return "We couldn’t publish this place. Please try again.";
}

export function publishBlockers(c: PlaceCandidate): string[] {
  const out: string[] = [];

  // One owner-understandable blocker for all Google-managed verification data.
  if (!hasGoogleVerification(c)) out.push(GOOGLE_VERIFICATION_BLOCKER);

  if (!c.category) out.push("Category required");
  if (!c.description || c.description.trim().length < 20)
    out.push("Original VeggieMeet description required (20+ characters)");
  if (
    c.image_rights_status !== "licensed" &&
    c.image_rights_status !== "owner_supplied" &&
    c.image_rights_status !== "restaurant_supplied" &&
    c.image_rights_status !== "none"
  )
    out.push(
      'Image rights must be "none" (no image), "owner_supplied", "restaurant_supplied" or "licensed"',
    );
  if (c.cover_image_url && c.image_rights_status === "none")
    out.push("A cover image requires cleared image rights");

  if (c.business_status && c.business_status !== "OPERATIONAL")
    out.push(`Google business status is ${c.business_status}`);
  if (c.verification_status === "published") out.push("Already published");
  if (c.verification_status === "rejected") out.push("Candidate is rejected");
  return out;
}

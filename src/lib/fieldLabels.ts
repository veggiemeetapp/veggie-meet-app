/**
 * WO-060 — one shared owner-facing field-label mapping.
 *
 * Internal snake_case column keys must never reach an owner-facing surface
 * (success banners, audit summaries, dashboards). Every screen that renders a
 * `changed_fields` array or a raw field key goes through `fieldLabel()`.
 * Unknown keys fall back to a humanised form instead of throwing.
 */
export const FIELD_LABELS: Record<string, string> = {
  // Google identity
  google_place_id: "Google Place ID",
  google_maps_url: "Google Maps link",
  google_website_url: "Official website",
  google_display_name: "Google listing name",
  google_formatted_address: "Google address",
  google_primary_type: "Google place type",
  business_status: "Google business status",

  // Public place details
  name: "Display name",
  public_display_name: "Public display name",
  display_name: "Display name",
  address: "Address",
  public_address: "Public address",
  formatted_address: "Address",
  neighborhood: "Area",
  district: "Area",
  category: "Place type",
  description: "Public description",
  veggie_reason: "Reason to visit",
  website_url: "Official website",
  cover_image_url: "Cover image",
  image_rights_status: "Image rights",

  // Geography
  latitude: "Latitude",
  longitude: "Longitude",
  coordinates: "Coordinates",
  city_id: "City",
  timezone: "Time zone",

  // Verification and status
  veggie_classification: "Vegan classification",
  maintenance_status: "Operational status",
  verification_status: "Verification status",
  is_active: "Discovery visibility",
  verified_at: "First verified",
  last_reverified_at: "Last reverified",
  status_note: "Status note",
  status_changed_at: "Status changed",
};

/** Owner-safe label for an internal field key. Never throws. */
export function fieldLabel(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  const cleaned = key.replace(/_at$/, "").replace(/_/g, " ").trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Comma-joined friendly labels for a list of field keys. */
export function fieldLabelList(keys: readonly string[] | null | undefined): string {
  const list = (keys ?? []).map(fieldLabel).filter(Boolean);
  return list.length > 0 ? list.join(", ") : "nothing";
}

import { supabase } from "@/integrations/supabase/client";

/**
 * WO-057 — Owner-only editing of the PUBLIC details of an already published
 * Community Place.
 *
 * Everything here is presentation support only. The server
 * (`update_community_place_details`) re-authorises with is_owner(), locks the
 * place row, validates every field, and derives the changed-field set itself —
 * a client-supplied "before" snapshot is never trusted. Google Place ID, vegan
 * classification, verification status, active state, maintenance status and the
 * verification dates are not parameters of the RPC at all, so they cannot be
 * changed through this workflow.
 */

export const EDITABLE_FIELDS = [
  "name",
  "address",
  "neighborhood",
  "category",
  "website_url",
  "google_maps_url",
  "coordinates",
  "description",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABEL: Record<EditableField, string> = {
  name: "Display name",
  address: "Formatted address",
  neighborhood: "Area",
  category: "Category",
  website_url: "Official website",
  google_maps_url: "Google Maps link",
  coordinates: "Coordinates",
  description: "Public description",
};

export const CATEGORY_OPTIONS = [
  { value: "restaurant", label: "Restaurant" },
  { value: "cafe", label: "Café" },
  { value: "park", label: "Park" },
  { value: "market", label: "Market" },
  { value: "studio", label: "Studio" },
  { value: "venue", label: "Venue" },
] as const;

export type DetailChangeSource =
  | "reverification"
  | "member_report"
  | "owner_review"
  | "google_check"
  | "manual_correction";

export const SOURCE_OPTIONS: Array<{ value: DetailChangeSource; label: string }> = [
  { value: "owner_review", label: "Owner review" },
  { value: "reverification", label: "Reverification" },
  { value: "member_report", label: "Member report" },
  { value: "google_check", label: "Verified Google Places check" },
  { value: "manual_correction", label: "Verified official source" },
];

export interface EditablePlace {
  id: string;
  name: string;
  address: string;
  neighborhood: string | null;
  category: string;
  website_url: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  is_active: boolean;
  maintenance_status: string;
  verification_status: string;
  veggie_classification: string | null;
  business_status: string | null;
  /** Owner-only. Locked: this workflow can never change Google identity. */
  google_place_id: string | null;
  has_google_place_id: boolean;

  verified_at: string | null;
  last_reverified_at: string | null;
  updated_at: string;
  city_name: string | null;
}

export interface EditWorkspaceReport {
  id: string;
  reason_code: string;
  explanation: string;
  official_source_url: string | null;
  status: string;
  created_at: string;
}

export interface EditWorkspaceReverification {
  id: string;
  status: string;
  result: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface DetailChangeEntry {
  id: string;
  changed_at: string;
  source: DetailChangeSource;
  source_reference_id: string | null;
  official_source_url: string | null;
  internal_note: string;
  changed_fields: string[];
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
}

export interface EditWorkspace {
  place: EditablePlace;
  open_reports: EditWorkspaceReport[];
  reverifications: EditWorkspaceReverification[];
  history: DetailChangeEntry[];
}

/** Proposed values held by the form. Coordinates are strings until submit. */
export interface DetailForm {
  name: string;
  address: string;
  neighborhood: string;
  category: string;
  website_url: string;
  google_maps_url: string;
  latitude: string;
  longitude: string;
  description: string;
}

export function formFromPlace(p: EditablePlace): DetailForm {
  return {
    name: p.name ?? "",
    address: p.address ?? "",
    neighborhood: p.neighborhood ?? "",
    category: p.category ?? "restaurant",
    website_url: p.website_url ?? "",
    google_maps_url: p.google_maps_url ?? "",
    latitude: p.latitude == null ? "" : String(p.latitude),
    longitude: p.longitude == null ? "" : String(p.longitude),
    description: p.description ?? "",
  };
}

/** Client-side preview of the changed set. The server recomputes it anyway. */
export function changedFields(p: EditablePlace, f: DetailForm): EditableField[] {
  const out: EditableField[] = [];
  const norm = (s: string) => s.trim();
  const nz = (s: string) => (norm(s) === "" ? null : norm(s));

  if (norm(f.name) !== (p.name ?? "")) out.push("name");
  if (norm(f.address) !== (p.address ?? "")) out.push("address");
  if (nz(f.neighborhood) !== (p.neighborhood ?? null)) out.push("neighborhood");
  if (norm(f.category) !== (p.category ?? "")) out.push("category");
  if (nz(f.website_url) !== (p.website_url ?? null)) out.push("website_url");
  if (nz(f.google_maps_url) !== (p.google_maps_url ?? null)) out.push("google_maps_url");
  const lat = f.latitude.trim() === "" ? null : Number(f.latitude);
  const lon = f.longitude.trim() === "" ? null : Number(f.longitude);
  if (lat !== (p.latitude ?? null) || lon !== (p.longitude ?? null)) out.push("coordinates");
  if (nz(f.description) !== (p.description ?? null)) out.push("description");
  return out;
}

export function currentValue(p: EditablePlace, field: EditableField): string {
  switch (field) {
    case "name":
      return p.name ?? "—";
    case "address":
      return p.address ?? "—";
    case "neighborhood":
      return p.neighborhood ?? "—";
    case "category":
      return CATEGORY_OPTIONS.find((c) => c.value === p.category)?.label ?? p.category;
    case "website_url":
      return p.website_url ?? "—";
    case "google_maps_url":
      return p.google_maps_url ?? "—";
    case "coordinates":
      return p.latitude == null || p.longitude == null
        ? "—"
        : `${p.latitude}, ${p.longitude}`;
    case "description":
      return p.description ?? "—";
  }
}

export function proposedValue(f: DetailForm, field: EditableField): string {
  switch (field) {
    case "name":
      return f.name.trim() || "—";
    case "address":
      return f.address.trim() || "—";
    case "neighborhood":
      return f.neighborhood.trim() || "—";
    case "category":
      return CATEGORY_OPTIONS.find((c) => c.value === f.category)?.label ?? f.category;
    case "website_url":
      return f.website_url.trim() || "—";
    case "google_maps_url":
      return f.google_maps_url.trim() || "—";
    case "coordinates":
      return f.latitude.trim() === "" || f.longitude.trim() === ""
        ? "—"
        : `${f.latitude.trim()}, ${f.longitude.trim()}`;
    case "description":
      return f.description.trim() || "—";
  }
}

/** Metres between two coordinate pairs — owner-facing "moved by" copy only. */
export function distanceMeters(
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
): number | null {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Calm, non-technical copy for every server refusal reason. */
export const FAILURE_COPY: Record<string, string> = {
  owner_only: "Owner access is required.",
  place_not_found: "That Community Place no longer exists.",
  place_not_published: "Only a published, verified place can be edited here.",
  invalid_source: "Choose where this correction came from.",
  invalid_note: "An internal note is required (up to 500 characters).",
  invalid_official_source_url: "The source link must be a plain http:// or https:// address.",
  invalid_source_reference: "That linked report or reverification doesn't belong to this place.",
  invalid_name: "Enter a real display name (2–160 characters, not just punctuation).",
  invalid_address: "Enter a real address (5–300 characters).",
  invalid_area: "This place needs an area, up to 120 characters.",
  invalid_category: "Pick one of the supported categories.",
  invalid_website: "The website must be a plain http:// or https:// address.",
  invalid_google_maps_url: "The Google Maps link must be a Google Maps address.",
  coordinates_incomplete: "Latitude and longitude must be provided together.",
  coordinates_required: "This place already has coordinates, so both are required.",
  invalid_coordinates:
    "Latitude must be between -90 and 90 and longitude between -180 and 180.",
  invalid_description: "The public description is too long (1000 characters maximum).",
  no_changes: "Nothing has changed, so there's nothing to save.",
  identity_change_blocked:
    "These changes look like a different business, not a correction. Nothing was changed — use a place replacement or a new place verification instead.",
  identity_risk_unacknowledged:
    "These changes are significant. Confirm the identity warning before saving.",
};

export const RISK_COPY: Record<string, string> = {
  coordinates_moved_far: "The coordinates move more than 1 km.",
  coordinates_moved: "The coordinates move more than 250 m.",
  name_changed_substantially: "The display name no longer resembles the current name.",
  name_changed: "The display name changes substantially.",
  address_changed_substantially: "The address no longer resembles the current address.",
  address_changed: "The address changes substantially.",
  category_inconsistent: "The new category is inconsistent with the existing place type.",
};

/** Bound wrapper — `supabase.rpc` loses its `this` binding when detached. */
const rpc = (
  name: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> =>
  (supabase.rpc as unknown as (
    n: string,
    a?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>).call(
    supabase,
    name,
    args,
  );

export async function fetchEditWorkspace(placeId: string): Promise<EditWorkspace> {
  const { data, error } = await rpc("get_community_place_edit_workspace", {
    _place_id: placeId,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { ok?: boolean; reason?: string } & EditWorkspace;
  if (d.ok === false) throw new Error(FAILURE_COPY[d.reason ?? ""] ?? "Couldn't load that place.");
  return d;
}

export interface UpdateResult {
  ok: boolean;
  reason?: string;
  risks?: string[];
  distance_m?: number | null;
  changed_fields?: string[];
  place?: EditablePlace;
}

export async function updatePlaceDetails(input: {
  placeId: string;
  form: DetailForm;
  source: DetailChangeSource;
  internalNote: string;
  officialSourceUrl: string | null;
  sourceReferenceId: string | null;
  acknowledgeIdentityRisk: boolean;
}): Promise<UpdateResult> {
  const f = input.form;
  const { data, error } = await rpc("update_community_place_details", {
    _place_id: input.placeId,
    _name: f.name,
    _address: f.address,
    _neighborhood: f.neighborhood,
    _category: f.category,
    _website_url: f.website_url,
    _google_maps_url: f.google_maps_url,
    _latitude: f.latitude.trim() === "" ? null : Number(f.latitude),
    _longitude: f.longitude.trim() === "" ? null : Number(f.longitude),
    _description: f.description,
    _source: input.source,
    _internal_note: input.internalNote,
    _official_source_url: input.officialSourceUrl,
    _source_reference_id: input.sourceReferenceId,
    _acknowledge_identity_risk: input.acknowledgeIdentityRisk,
  });
  if (error) throw new Error(error.message);
  return (data ?? { ok: false, reason: "no_changes" }) as UpdateResult;
}

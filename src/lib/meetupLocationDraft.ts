import type { CustomLocationValue } from "@/components/host/CustomLocationSearch";

/**
 * WO-148 — location editing integrity helpers.
 *
 * A display-name (or address) edit is metadata only: coordinates, the provider
 * place id and the Maps link belong to the *chosen place* and must survive it.
 * Structured data changes only when a genuinely different place is selected.
 */
export function applyNameEdit(
  value: CustomLocationValue,
  name: string,
): CustomLocationValue {
  return { ...value, name };
}

export function applyAddressEdit(
  value: CustomLocationValue,
  address: string,
): CustomLocationValue {
  return { ...value, address };
}

export interface GoogleMetaUpdate {
  googlePlaceId: string | null;
  googleMapsUrl: string | null;
}

/**
 * Decide whether the stored provider reference needs writing at all.
 *
 * Returns `null` when nothing changed — so a name-only save never issues a
 * write that could clear an existing map pin (DEF-148-03).
 */
export function resolveGoogleMetaUpdate(
  stored: GoogleMetaUpdate,
  draft: GoogleMetaUpdate,
  isCustom: boolean,
): GoogleMetaUpdate | null {
  const next: GoogleMetaUpdate = isCustom
    ? { googlePlaceId: draft.googlePlaceId ?? null, googleMapsUrl: draft.googleMapsUrl ?? null }
    : { googlePlaceId: null, googleMapsUrl: null };
  const same =
    (stored.googlePlaceId ?? null) === next.googlePlaceId &&
    (stored.googleMapsUrl ?? null) === next.googleMapsUrl;
  return same ? null : next;
}

/** Empty/whitespace-only names are never a valid location draft. */
export function validateLocationDraft(value: CustomLocationValue): string | null {
  if (value.name.trim().length === 0) {
    return "Add a location name so attendees know where to go.";
  }
  return null;
}

import { supabase } from "@/integrations/supabase/client";

/**
 * WO-062 — Meetup ↔ Community Place integration data layer.
 *
 * The Meetup location snapshot is historical event data. This module never
 * mutates it: it only reads the server-derived comparison between the Meetup
 * snapshot and the current Community Place, plus an explicit host-authorised
 * action to adopt the place's current location.
 *
 * Privacy: the server payload never contains coordinates, Google Place IDs,
 * verification evidence, owner notes, or moderation history (WO-061/061A).
 */

export type LocationIntegrityState =
  | "current"
  | "details_changed"
  | "relocated"
  | "temporarily_unavailable"
  | "permanently_unavailable"
  | "vegan_status_unconfirmed"
  | "place_hidden";

export interface MeetupPlaceBlock {
  id: string;
  publicName: string;
  category: string;
  isPubliclyAvailable: boolean;
  isFullyVegan: boolean;
  statusLabel: string;
  memberMessage: string | null;
  locationIntegrityState: LocationIntegrityState;
  snapshotIsCurrent: boolean;
  publicPlaceRoute: string | null;
  directionsAllowed: boolean;
  memberHasSupportedPlace: boolean;
  memberVerifiedVisitCount: number;
}

export interface MeetupSnapshotBlock {
  locationName: string | null;
  address: string | null;
  neighborhood: string | null;
  cityName: string | null;
}

export interface MeetupHostLocationBlock {
  actionRequired: boolean;
  actionLevel: "none" | "optional" | "recommended" | "required";
  statusLabel: string;
  changedFields: string[];
  canAcceptCurrentPlace: boolean;
  currentPlace: {
    name: string;
    address: string;
    neighborhood: string | null;
    category: string;
    isPubliclyAvailable: boolean;
  } | null;
}

export interface MeetupPlaceContext {
  found: boolean;
  linked: boolean;
  isHost: boolean;
  isHistorical: boolean;
  place: MeetupPlaceBlock | null;
  snapshot: MeetupSnapshotBlock | null;
  host: MeetupHostLocationBlock | null;
}

export async function fetchMeetupPlaceContext(
  meetupId: string,
): Promise<MeetupPlaceContext> {
  const { data, error } = await supabase.rpc("get_meetup_place_context" as never, {
    _meetup_id: meetupId,
  } as never);
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as Record<string, any>;
  if (!raw.found || !raw.linked) {
    return {
      found: !!raw.found,
      linked: false,
      isHost: false,
      isHistorical: false,
      place: null,
      snapshot: null,
      host: null,
    };
  }
  const cp = raw.community_place ?? {};
  const sn = raw.snapshot ?? {};
  const h = raw.host ?? null;
  return {
    found: true,
    linked: true,
    isHost: !!raw.is_host,
    isHistorical: !!raw.is_historical,
    place: {
      id: cp.id,
      publicName: cp.public_name ?? "",
      category: cp.category ?? "venue",
      isPubliclyAvailable: !!cp.is_publicly_available,
      isFullyVegan: !!cp.is_fully_vegan,
      statusLabel: cp.status_label ?? "",
      memberMessage: cp.member_message ?? null,
      locationIntegrityState: (cp.location_integrity_state ??
        "current") as LocationIntegrityState,
      snapshotIsCurrent: !!cp.snapshot_is_current,
      publicPlaceRoute: cp.public_place_route ?? null,
      directionsAllowed: !!cp.directions_allowed,
      memberHasSupportedPlace: !!cp.member_has_supported_place,
      memberVerifiedVisitCount: cp.member_verified_visit_count ?? 0,
    },
    snapshot: {
      locationName: sn.location_name ?? null,
      address: sn.address ?? null,
      neighborhood: sn.neighborhood ?? null,
      cityName: sn.city_name ?? null,
    },
    host: h
      ? {
          actionRequired: !!h.action_required,
          actionLevel: h.action_level ?? "none",
          statusLabel: h.status_label ?? "Up to date",
          changedFields: (h.changed_fields ?? []) as string[],
          canAcceptCurrentPlace: !!h.can_accept_current_place,
          currentPlace: h.current_place
            ? {
                name: h.current_place.name,
                address: h.current_place.address,
                neighborhood: h.current_place.neighborhood ?? null,
                category: h.current_place.category,
                isPubliclyAvailable: !!h.current_place.is_publicly_available,
              }
            : null,
        }
      : null,
  };
}

/**
 * Host-only: intentionally move the Meetup snapshot to the Community Place's
 * current location. Server re-validates host authorisation and place
 * eligibility, writes the location audit row, and notifies attendees through
 * the existing update_meetup_location mechanism.
 */
export async function acceptMeetupCurrentPlaceLocation(
  meetupId: string,
): Promise<void> {
  const { error } = await supabase.rpc(
    "accept_meetup_current_place_location" as never,
    { _meetup_id: meetupId } as never,
  );
  if (error) throw new Error(error.message);
}

/** Snapshot-safe directions URL — built from the Meetup snapshot, never place coordinates. */
export function snapshotDirectionsHref(
  snapshot: MeetupSnapshotBlock | null,
): string | null {
  const q = [snapshot?.locationName, snapshot?.address, snapshot?.cityName]
    .filter(Boolean)
    .join(" ");
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

import { supabase } from "@/integrations/supabase/client";
import type { CommunityPlaceMaintenanceStatus } from "@/types";

/**
 * WO-053 — Owner-only Community Place status maintenance.
 *
 * Every call here is re-authorised server-side by is_owner(); a non-owner
 * receives a permission error and never sees maintenance data.
 */

export interface MaintenancePlace {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  neighborhood: string | null;
  veggie_classification: string | null;
  maintenance_status: CommunityPlaceMaintenanceStatus;
  status_note: string | null;
  status_changed_at: string | null;
  last_reverified_at: string | null;
  verification_status: string | null;
  business_status: string | null;
  is_active: boolean;
  google_maps_url: string | null;
  upcoming_meetups_here: number;
}

export interface StatusHistoryEntry {
  id: string;
  old_status: string | null;
  new_status: string;
  old_is_active: boolean | null;
  new_is_active: boolean | null;
  action: string;
  note: string | null;
  created_at: string;
}

export const MAINTENANCE_STATUS_LABEL: Record<CommunityPlaceMaintenanceStatus, string> = {
  operational: "Operational",
  needs_reverification: "Needs reverification",
  temporarily_closed: "Temporarily closed",
  permanently_closed: "Permanently closed",
};

/** Public-facing banner copy for a place that isn't operational. */
export function placeStatusBanner(
  status: CommunityPlaceMaintenanceStatus | undefined,
): { title: string; tone: "warning" | "closed" } | null {
  switch (status) {
    case "needs_reverification":
      return { title: "Vegan verification under review", tone: "warning" };
    case "temporarily_closed":
      return { title: "Temporarily closed", tone: "warning" };
    case "permanently_closed":
      return { title: "Permanently closed", tone: "closed" };
    default:
      return null;
  }
}

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

export async function fetchMaintenancePlaces(): Promise<MaintenancePlace[]> {
  const { data, error } = await rpc("get_community_place_maintenance");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { places?: MaintenancePlace[] };
  return d.places ?? [];
}

export async function fetchPlaceStatusHistory(
  placeId: string,
): Promise<StatusHistoryEntry[]> {
  const { data, error } = await rpc("get_community_place_status_history", {
    _place_id: placeId,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { entries?: StatusHistoryEntry[] };
  return d.entries ?? [];
}

export async function setPlaceStatus(
  placeId: string,
  status: CommunityPlaceMaintenanceStatus,
  note: string | null,
): Promise<void> {
  const { error } = await rpc("set_community_place_status", {
    _place_id: placeId,
    _status: status,
    _note: note,
  });
  if (error) throw new Error(error.message);
}

export async function reverifyPlace(
  placeId: string,
  note: string,
  veggieClassification?: string | null,
): Promise<void> {
  const { error } = await rpc("reverify_community_place", {
    _place_id: placeId,
    _note: note,
    _veggie_classification: veggieClassification ?? null,
  });
  if (error) throw new Error(error.message);
}

import { supabase } from "@/integrations/supabase/client";

/**
 * WO-047 — private "Places You've Supported" data access.
 *
 * All rows come from the server-authoritative get_my_supported_places() RPC,
 * which resolves the actor via current_profile_id(). No profile id is ever
 * sent from the client and no coordinates/accuracy/distance are returned.
 */

export type SupportSource = "direct_place_visit" | "meetup_attendance" | "both";

export interface SupportedPlace {
  community_place_id: string;
  name: string;
  category: string;
  neighborhood: string | null;
  address: string | null;
  cover_image_url: string | null;
  has_cover_image: boolean;
  veggie_classification: string | null;
  is_active: boolean;
  /** WO-053 neutral current status: operational | needs_reverification | temporarily_closed | permanently_closed */
  maintenance_status?: string | null;
  first_activity_at: string | null;
  last_activity_at: string | null;
  direct_visit_count: number;
  support_source: SupportSource;
}

export interface SupportedPlacesResult {
  places: SupportedPlace[];
  distinct_supported: number;
  direct_visits_total: number;
}

export async function fetchMySupportedPlaces(): Promise<SupportedPlacesResult> {
  const { data, error } = await (supabase.rpc as any)("get_my_supported_places");
  if (error) throw error;
  const d = (data ?? {}) as Partial<SupportedPlacesResult>;
  return {
    places: (d.places as SupportedPlace[]) ?? [],
    distinct_supported: d.distinct_supported ?? 0,
    direct_visits_total: d.direct_visits_total ?? 0,
  };
}

export const SUPPORT_SOURCE_LABEL: Record<SupportSource, string> = {
  direct_place_visit: "Checked in here",
  meetup_attendance: "Attended a meetup here",
  both: "Checked in and attended a meetup",
};

/** Today / Yesterday / Aug 1, 2026 — local timezone, no times. */
export function formatActivityDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * WO-125 — canonical label lookup for a bounded set of interest ids.
 *
 * `fetchInterestCatalogue` intentionally returns only ACTIVE rows (so retired
 * interests can never reappear in a picker). Display surfaces need the opposite
 * guarantee: a historical Meetup tagged with a retired-but-resolvable interest
 * must still read correctly. This helper reads labels by id without the active
 * filter and is never used to populate selection UI.
 */

import { supabase } from "@/integrations/supabase/client";

export async function fetchInterestLabels(
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
  if (!unique.length) return {};
  const { data, error } = await supabase
    .from("interest_catalogue" as never)
    .select("id, label")
    .in("id" as never, unique);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as unknown as Array<{ id: string; label: string }>) {
    if (row?.id && typeof row.label === "string" && row.label.trim()) {
      out[row.id] = row.label;
    }
  }
  return out;
}

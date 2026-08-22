/**
 * WO-126A / DEF-126-01 — one resolver for every member-facing Meetup category label.
 *
 * The canonical Primary interest id is the source of truth. The legacy
 * `meetups.category` enum stays only as an internal compatibility field: it is
 * never displayed when a canonical Primary id exists, because most canonical
 * categories collapse to the residual enum member `other`.
 *
 * Rules:
 * - canonical Primary id present  -> canonical catalogue label (never raw ids)
 * - canonical id present but unresolved (unknown/retired/malformed, or labels
 *   still loading) -> render nothing, so no inaccurate label is ever shown
 * - no canonical id (historical Meetup) -> explicit legacy enum fallback label,
 *   except the residual member `other`, which is never displayed
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchInterestLabels } from "@/lib/interestLabels";

/** Display labels for the legacy compatibility enum (fallback only). */
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  dinner: "Dinner",
  brunch: "Brunch",
  coffee: "Coffee",
  picnic: "Picnic",
  cooking: "Cooking",
  walk: "Walk",
  workshop: "Workshop",
};

/**
 * DEF-126-01 — `other` is a residual compatibility value, never a real
 * member-facing category, so it is deliberately absent from this map.
 */

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function legacyCategoryLabel(category?: string | null): string | null {
  const c = clean(category)?.toLowerCase();
  if (!c) return null;
  return LEGACY_CATEGORY_LABELS[c] ?? null;
}

/**
 * Resolve the single label a member should see.
 * `labels` is an id -> label map from the canonical catalogue.
 */
export function resolveMeetupCategoryLabel(
  primaryInterestId: string | null | undefined,
  legacyCategory: string | null | undefined,
  labels: Record<string, string> | undefined,
): string | null {
  const primaryId = clean(primaryInterestId);
  if (primaryId) {
    // Canonical data exists: never fall back to the compatibility enum.
    const label = labels?.[primaryId];
    return clean(label) ?? null;
  }
  return legacyCategoryLabel(legacyCategory);
}

/**
 * Batched label lookup for a list surface. One bounded query per set of ids.
 */
export function useMeetupCategoryLabels(
  primaryInterestIds: Array<string | null | undefined>,
) {
  const ids = useMemo(() => {
    const out = new Set<string>();
    for (const raw of primaryInterestIds) {
      const id = clean(raw);
      if (id) out.add(id);
    }
    return [...out].sort();
  }, [primaryInterestIds]);

  const query = useQuery({
    queryKey: ["interest-labels", ids],
    enabled: ids.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: () => fetchInterestLabels(ids),
  });

  const labels = query.data;
  return useMemo(
    () => ({
      labels,
      labelFor: (
        primaryInterestId: string | null | undefined,
        legacyCategory?: string | null,
      ) => resolveMeetupCategoryLabel(primaryInterestId, legacyCategory, labels),
    }),
    [labels],
  );
}

/** Single-Meetup convenience wrapper. */
export function useMeetupCategoryLabel(
  primaryInterestId: string | null | undefined,
  legacyCategory?: string | null,
): string | null {
  const { labelFor } = useMeetupCategoryLabels([primaryInterestId]);
  return labelFor(primaryInterestId, legacyCategory);
}

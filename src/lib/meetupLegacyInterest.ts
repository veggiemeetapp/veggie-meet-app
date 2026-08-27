/**
 * WO-134 / DEF-134-02 — recover a usable Main interest for older Meetups.
 *
 * Meetups created before the canonical taxonomy (WO-124/WO-126) can still carry
 * only the legacy compatibility enum `meetups.category`. When such a Meetup is
 * opened in Manage Meetup it has no Main interest selected, so hosts must be
 * able to (re)assign one.
 *
 * The mapping below is the exact inverse of the approved server mapping
 * `public.legacy_meetup_category_for_interest`, restricted to legacy values with
 * a single unambiguous canonical target. `walk` resolves to `walking` (the same
 * pairing recorded in `public.interest_legacy_map`). Ambiguous or residual
 * values (`brunch`, `other`) are deliberately absent: no taxonomy is invented
 * here, the host chooses instead.
 */

import type { InterestOption } from "@/lib/onboarding";

export const LEGACY_MEETUP_CATEGORY_TO_INTEREST: Record<string, string> = {
  coffee: "coffee",
  cooking: "cooking",
  dinner: "dining_out",
  picnic: "picnics",
  walk: "walking",
  workshop: "workshops_learning",
};

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export interface RecoveredPrimaryInterest {
  /** Id to preselect in the picker, or null when the host must choose. */
  primaryId: string | null;
  /** True when the id came from the legacy enum rather than stored taxonomy. */
  mappedFromLegacy: boolean;
  /** True when nothing selectable could be resolved — show the recovery hint. */
  needsRecovery: boolean;
}

/**
 * Resolve the Main interest to preselect when editing a Meetup.
 *
 * - a stored canonical id that exists in the selectable catalogue wins
 * - otherwise the legacy enum is mapped, when the mapping is unambiguous and
 *   the target interest is still selectable
 * - otherwise nothing is preselected and recovery is required
 */
export function recoverPrimaryInterest(
  storedPrimaryInterestId: string | null | undefined,
  legacyCategory: string | null | undefined,
  options: InterestOption[],
): RecoveredPrimaryInterest {
  const selectable = new Set(options.map((o) => o.id));
  const stored = clean(storedPrimaryInterestId);
  if (stored && selectable.has(stored)) {
    return { primaryId: stored, mappedFromLegacy: false, needsRecovery: false };
  }

  const legacy = clean(legacyCategory)?.toLowerCase();
  const mapped = legacy ? LEGACY_MEETUP_CATEGORY_TO_INTEREST[legacy] : undefined;
  if (mapped && selectable.has(mapped)) {
    return { primaryId: mapped, mappedFromLegacy: true, needsRecovery: false };
  }

  return { primaryId: null, mappedFromLegacy: false, needsRecovery: true };
}

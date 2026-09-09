/**
 * WO-149 — deterministic normalisation of a Meetup's category draft.
 *
 * Older/legacy Meetup rows can carry additional interest ids that are
 * duplicated, that repeat the main category, or that exceed the current limit.
 * Opening Manage Meetup must never silently rewrite stored data, so this helper
 * is purely a draft/save-time guard:
 *
 * - the main category is never duplicated inside the additional list
 * - duplicate additional ids collapse to their first occurrence
 * - original order is preserved (no reordering)
 * - at most `MEETUP_MAX_ADDITIONAL_INTERESTS` additional ids survive
 * - unknown/retired additional ids are preserved, not invented or dropped, so a
 *   host editing an unrelated field cannot lose historical tags
 */

import { MEETUP_MAX_ADDITIONAL_INTERESTS } from "@/lib/interests";

const clean = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function normalizeAdditionalInterestIds(
  primaryId: string | null | undefined,
  additionalIds: Array<string | null | undefined> | null | undefined,
): string[] {
  const primary = clean(primaryId);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of additionalIds ?? []) {
    const id = clean(raw);
    if (!id) continue;
    if (primary && id === primary) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MEETUP_MAX_ADDITIONAL_INTERESTS) break;
  }
  return out;
}

/**
 * WO-149B — what a save is allowed to write to the category columns.
 *
 * `update_hosted_meetup` leaves `primary_interest_id`, `additional_interest_ids`
 * and the legacy `category` enum completely untouched when no main category is
 * supplied. That is the only way to guarantee that an unrelated edit (title,
 * date, capacity, cover, …) preserves stored category data exactly — including
 * historical shapes the current client would otherwise deduplicate, cap,
 * reorder or drop (unknown / retired ids).
 *
 * So the category columns are written only when the host explicitly touched the
 * category picker in this editing session. Anything else omits them.
 */
export function resolveCategoryUpdate(
  touched: boolean,
  primaryId: string | null | undefined,
  additionalIds: Array<string | null | undefined> | null | undefined,
): { primaryInterestId: string | null; additionalInterestIds?: string[] } {
  const primary = clean(primaryId);
  if (!touched || !primary) {
    // Omit the category write entirely — the server preserves what is stored.
    return { primaryInterestId: null };
  }
  return {
    primaryInterestId: primary,
    additionalInterestIds: normalizeAdditionalInterestIds(primary, additionalIds),
  };
}


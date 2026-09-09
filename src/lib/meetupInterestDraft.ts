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

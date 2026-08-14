/**
 * WO-108 DEF-108-01 — single source of truth for the fixed-vocabulary
 * candidate fields, mirroring the LIVE production database contract:
 *
 *   place_candidates_veggie_classification_check
 *     CHECK (veggie_classification IS NULL OR veggie_classification = ANY
 *       ('{fully_vegan,fully_vegetarian,vegetarian_friendly,vegan_options,not_food}'))
 *   place_candidates_image_rights_status_check
 *     CHECK (image_rights_status = ANY
 *       ('{none,owner_supplied,restaurant_supplied,licensed}'))   -- NOT NULL, default 'none'
 *   place_candidates.category  ->  enum place_category
 *       (restaurant, cafe, park, market, studio, venue)           -- nullable on drafts
 *
 * The database CHECK constraints remain fully enforced. These options exist so
 * the owner UI can never emit a value the database will reject.
 */

export interface VocabularyOption {
  /** Exact canonical token persisted to the database. Never localised. */
  value: string;
  /** Human-friendly owner label. Never a raw database token. */
  label: string;
}

export const VEGGIE_CLASSIFICATIONS: readonly VocabularyOption[] = [
  { value: "fully_vegan", label: "100% vegan" },
  { value: "fully_vegetarian", label: "100% vegetarian" },
  { value: "vegetarian_friendly", label: "Vegetarian friendly" },
  { value: "vegan_options", label: "Has vegan options" },
  { value: "not_food", label: "Not a food place" },
] as const;

export const IMAGE_RIGHTS_OPTIONS: readonly VocabularyOption[] = [
  { value: "none", label: "No image / no rights cleared" },
  { value: "owner_supplied", label: "Supplied by VeggieMeet owner" },
  { value: "restaurant_supplied", label: "Supplied by the place" },
  { value: "licensed", label: "Licensed image" },
] as const;

export const PLACE_CATEGORIES: readonly VocabularyOption[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "cafe", label: "Café" },
  { value: "park", label: "Park" },
  { value: "market", label: "Market" },
  { value: "studio", label: "Studio" },
  { value: "venue", label: "Venue" },
] as const;

const values = (o: readonly VocabularyOption[]) => o.map((x) => x.value);

/** Drafts legitimately allow NULL classification (live CHECK permits NULL). */
export function isValidClassification(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return typeof v === "string" && values(VEGGIE_CLASSIFICATIONS).includes(v);
}

/** image_rights_status is NOT NULL in production: NULL/empty is invalid. */
export function isValidImageRights(v: unknown): boolean {
  return typeof v === "string" && values(IMAGE_RIGHTS_OPTIONS).includes(v);
}

/** category is a nullable enum column: NULL is allowed on drafts. */
export function isValidCategory(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return typeof v === "string" && values(PLACE_CATEGORIES).includes(v);
}

export const CLASSIFICATION_INVALID_MESSAGE =
  "Choose a valid vegan/vegetarian classification.";
export const IMAGE_RIGHTS_INVALID_MESSAGE = "Choose a valid image rights status.";
export const CATEGORY_INVALID_MESSAGE = "Choose a valid category.";

export function labelFor(options: readonly VocabularyOption[], value: string | null): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * Defence in depth: even with controlled selects, a database CHECK violation
 * must never surface Postgres internals (relation, constraint name, SQLSTATE).
 */
export function mapCandidateConstraintError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("veggie_classification")) return CLASSIFICATION_INVALID_MESSAGE;
  if (m.includes("image_rights_status")) return IMAGE_RIGHTS_INVALID_MESSAGE;
  if (m.includes("place_category") || m.includes("category")) return CATEGORY_INVALID_MESSAGE;
  if (m.includes("check constraint") || m.includes("violates"))
    return "Some details don’t match the allowed options. Review the highlighted fields.";
  if (m.includes("permission denied"))
    return "Only the VeggieMeet owner can edit place candidates.";
  return "We couldn’t save this draft. Please try again.";
}

/** Client-side validation of a candidate patch before it is sent. */
export function validateCandidatePatch(patch: {
  veggie_classification?: string | null;
  image_rights_status?: string | null;
  category?: string | null;
}): string | null {
  if ("veggie_classification" in patch && !isValidClassification(patch.veggie_classification))
    return CLASSIFICATION_INVALID_MESSAGE;
  if ("image_rights_status" in patch && !isValidImageRights(patch.image_rights_status))
    return IMAGE_RIGHTS_INVALID_MESSAGE;
  if ("category" in patch && !isValidCategory(patch.category)) return CATEGORY_INVALID_MESSAGE;
  return null;
}

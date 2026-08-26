import { mapLifecycleError } from "@/lib/candidatePublish";

/**
 * WO-132 DEF-132-01 — Community Place publication error taxonomy.
 *
 * The publish RPCs raise stable machine-readable codes (PLACE_*). This module
 * turns them into owner-facing copy that always answers two questions:
 * 1. what happened, 2. what to do next. Raw SQL, SQLSTATE, constraint names and
 * PostgREST internals never reach the UI.
 */

export type PlacePublishErrorCode =
  | "PLACE_REQUIRED_FIELD_MISSING"
  | "PLACE_GOOGLE_ID_MISSING"
  | "PLACE_ADDRESS_MISSING"
  | "PLACE_COORDINATES_MISSING"
  | "PLACE_BUSINESS_STATUS_INVALID"
  | "PLACE_CATEGORY_MISSING"
  | "PLACE_DESCRIPTION_MISSING"
  | "PLACE_VEGGIE_REASON_MISSING"
  | "PLACE_VEGGIE_CLASSIFICATION_MISSING"
  | "PLACE_IMAGE_RIGHTS_INVALID"
  | "PLACE_DUPLICATE_GOOGLE_ID"
  | "PLACE_DUPLICATE_NAME_ADDRESS"
  | "PLACE_ALREADY_PUBLISHED"
  | "PLACE_REJECTED"
  | "PLACE_INVALID_STATE"
  | "PLACE_NOT_FOUND"
  | "PLACE_PERMISSION_DENIED"
  | "PLACE_AUTH_EXPIRED"
  | "PLACE_NETWORK"
  | "PLACE_UNKNOWN";

/** Which candidate field the owner should fix, when it is deterministic. */
export type PlacePublishField =
  | "google"
  | "category"
  | "description"
  | "veggie_reason"
  | "veggie_classification"
  | "image_rights_status"
  | null;

export interface ClassifiedPlacePublishError {
  code: PlacePublishErrorCode;
  /** Owner-facing message: what happened + what to do next. */
  message: string;
  /** Deterministic field to focus, when applicable. */
  field: PlacePublishField;
  retryable: boolean;
}

const COPY: Record<
  PlacePublishErrorCode,
  { message: string; field: PlacePublishField; retryable: boolean }
> = {
  PLACE_REQUIRED_FIELD_MISSING: {
    message: "Some required details are missing. Complete the candidate fields, then publish again.",
    field: null,
    retryable: false,
  },
  PLACE_GOOGLE_ID_MISSING: {
    message: "Confirm this place with Google before publishing.",
    field: "google",
    retryable: false,
  },
  PLACE_ADDRESS_MISSING: {
    message: "This candidate has no verified address. Confirm the correct Google result again.",
    field: "google",
    retryable: false,
  },
  PLACE_COORDINATES_MISSING: {
    message: "This candidate has no verified location. Confirm the correct Google result again.",
    field: "google",
    retryable: false,
  },
  PLACE_BUSINESS_STATUS_INVALID: {
    message:
      "Google reports this business is not operational, so it can’t be published. Re-confirm it with Google or reject the candidate.",
    field: "google",
    retryable: false,
  },
  PLACE_CATEGORY_MISSING: {
    message: "Choose a category for this place, then publish again.",
    field: "category",
    retryable: false,
  },
  PLACE_DESCRIPTION_MISSING: {
    message: "Add a short Community Place description (20+ characters), then publish again.",
    field: "description",
    retryable: false,
  },
  PLACE_VEGGIE_REASON_MISSING: {
    message: "Explain why this place is veggie-friendly, then publish again.",
    field: "veggie_reason",
    retryable: false,
  },
  PLACE_VEGGIE_CLASSIFICATION_MISSING: {
    message: "Choose a vegan/vegetarian classification, then publish again.",
    field: "veggie_classification",
    retryable: false,
  },
  PLACE_IMAGE_RIGHTS_INVALID: {
    message: "Choose the correct image-rights option for this candidate’s cover image.",
    field: "image_rights_status",
    retryable: false,
  },
  PLACE_DUPLICATE_GOOGLE_ID: {
    message:
      "We couldn’t publish this place because it already exists in Community Places. Open the published place instead of publishing a second copy.",
    field: null,
    retryable: false,
  },
  PLACE_DUPLICATE_NAME_ADDRESS: {
    message:
      "A published place already uses this name and address. Check Community Places before publishing again.",
    field: null,
    retryable: false,
  },
  PLACE_ALREADY_PUBLISHED: {
    message: "This place is already published in Community Places.",
    field: null,
    retryable: false,
  },
  PLACE_REJECTED: {
    message: "This candidate was rejected, so it can’t be published.",
    field: null,
    retryable: false,
  },
  PLACE_INVALID_STATE: {
    message: "This candidate changed since you opened it. Refresh the list and try again.",
    field: null,
    retryable: true,
  },
  PLACE_NOT_FOUND: {
    message: "This candidate could no longer be found. Refresh the list and try again.",
    field: null,
    retryable: true,
  },
  PLACE_PERMISSION_DENIED: {
    message: "Only the VeggieMeet owner can verify and publish places.",
    field: null,
    retryable: false,
  },
  PLACE_AUTH_EXPIRED: {
    message: "Your session expired. Sign in again to publish this place.",
    field: null,
    retryable: true,
  },
  PLACE_NETWORK: {
    message: "Your connection was interrupted. Check your internet connection and try again.",
    field: null,
    retryable: true,
  },
  PLACE_UNKNOWN: {
    message:
      "We couldn’t publish this place. Your candidate changes are still here. Please try again. If it keeps happening, contact support.",
    field: null,
    retryable: true,
  },
};

const CODES = Object.keys(COPY) as PlacePublishErrorCode[];

function rawText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const m = (error as { message?: unknown })?.message;
  return typeof m === "string" ? m : String(error ?? "");
}

export function classifyPlacePublishError(error: unknown): ClassifiedPlacePublishError {
  const raw = rawText(error);
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();

  for (const code of CODES) {
    if (upper.includes(code)) return { code, ...COPY[code] };
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed") ||
    lower.includes("offline")
  ) {
    return { code: "PLACE_NETWORK", ...COPY.PLACE_NETWORK };
  }
  if (
    lower.includes("jwt expired") ||
    lower.includes("token is expired") ||
    lower.includes("refresh token") ||
    lower.includes("not authenticated") ||
    lower.includes("session expired") ||
    lower.includes("invalid claim")
  ) {
    return { code: "PLACE_AUTH_EXPIRED", ...COPY.PLACE_AUTH_EXPIRED };
  }
  if (lower.includes("permission denied") || lower.includes("42501")) {
    return { code: "PLACE_PERMISSION_DENIED", ...COPY.PLACE_PERMISSION_DENIED };
  }
  if (lower.includes("already published") || lower.includes("already been published")) {
    return { code: "PLACE_ALREADY_PUBLISHED", ...COPY.PLACE_ALREADY_PUBLISHED };
  }

  // Legacy server copy (pre-taxonomy deployments) still maps to safe wording.
  const legacy = mapLifecycleError(raw);
  if (legacy !== "We couldn’t publish this place. Please try again.") {
    return { code: "PLACE_REQUIRED_FIELD_MISSING", message: legacy, field: null, retryable: false };
  }

  return { code: "PLACE_UNKNOWN", ...COPY.PLACE_UNKNOWN };
}

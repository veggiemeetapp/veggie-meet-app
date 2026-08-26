/**
 * WO-133 — canonical Meetup cover pipeline.
 *
 * There is exactly ONE cover pipeline in the app, shared by Host creation and
 * Manage Meetup editing. It was extracted from `Host.tsx` (WO-131 / WO-131B)
 * unchanged so create and edit can never diverge on security rules.
 *
 * Architecture (verified against production):
 *  - Storage: the processed cover lives inline in `public.meetups.cover_image_url`
 *    as a `data:image/jpeg;base64,…` URL, or as an `https://…` URL for the
 *    stock fallback. There is NO storage object, so replacement is a single
 *    atomic row UPDATE and orphan cleanup does not apply.
 *  - Server gate: the `meetups` table trigger `validate_meetup_cover()` calls
 *    `is_allowed_meetup_cover()` on every INSERT *and* UPDATE — https URLs and
 *    base64 jpeg/png/webp only, 500,000 char ceiling. SVG, `javascript:`,
 *    `data:text/html` and arbitrary data URLs are rejected there regardless of
 *    which client path is used.
 *  - No cover: canonical value is NULL. `sanitizeCover()` maps NULL to the
 *    stock fallback image on every member-facing surface.
 */

import {
  MEETUP_COVER_ALLOWED_MIME,
  MEETUP_COVER_MAX_CHARS,
  MEETUP_COVER_TARGET_CHARS,
  isAllowedCoverFile,
} from "@/lib/meetupPublishErrors";

export {
  MEETUP_COVER_ALLOWED_MIME,
  MEETUP_COVER_MAX_CHARS,
  MEETUP_COVER_TARGET_CHARS,
  MEETUP_COVER_MAX_INPUT_BYTES,
  isAllowedCoverFile,
} from "@/lib/meetupPublishErrors";

/**
 * Downscale ladder. Documented policy: max dimension 1280px, JPEG quality
 * 0.8 → 0.5, final payload ceiling 460,000 chars (under the server's 500,000).
 * Re-encoding through a canvas also strips EXIF — including orientation, which
 * `createImageBitmap` has already applied, and GPS, which is never persisted.
 */
export const COVER_ENCODE_LADDER: ReadonlyArray<{ max: number; quality: number }> = [
  { max: 1280, quality: 0.8 },
  { max: 1280, quality: 0.65 },
  { max: 1024, quality: 0.6 },
  { max: 800, quality: 0.55 },
  { max: 640, quality: 0.5 },
];

export type CoverErrorCode =
  | "COVER_UNSUPPORTED_TYPE"
  | "COVER_TOO_LARGE"
  | "COVER_PROCESSING_FAILED";

export const COVER_ERROR_COPY: Record<CoverErrorCode, string> = {
  COVER_UNSUPPORTED_TYPE: "Choose a JPG, PNG, or WebP photo.",
  COVER_TOO_LARGE: "That cover photo is too large to attach. Choose a smaller image.",
  COVER_PROCESSING_FAILED: "We couldn’t prepare that photo. Try another image.",
};

export type CoverProcessResult =
  | { status: "ok"; dataUrl: string }
  | { status: "error"; code: CoverErrorCode; message: string };

function fail(code: CoverErrorCode): CoverProcessResult {
  return { status: "error", code, message: COVER_ERROR_COPY[code] };
}

/**
 * Validate, decode and re-encode a host-selected cover file into a payload the
 * server will accept. Never throws.
 */
export async function processMeetupCoverFile(file: File): Promise<CoverProcessResult> {
  // WO-131B intake allowlist: the declared MIME type is checked (never the
  // filename), document formats such as SVG are refused, and an oversized
  // input never reaches the decoder.
  if (!isAllowedCoverFile(file)) return fail("COVER_UNSUPPORTED_TYPE");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fail("COVER_PROCESSING_FAILED");
  }

  try {
    for (const attempt of COVER_ENCODE_LADDER) {
      const scale = Math.min(1, attempt.max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", attempt.quality);
      if (url.length <= MEETUP_COVER_TARGET_CHARS) return { status: "ok", dataUrl: url };
    }
    return fail("COVER_TOO_LARGE");
  } catch {
    return fail("COVER_PROCESSING_FAILED");
  } finally {
    bitmap.close?.();
  }
}

/* ------------------------------------------------------------------ *
 * Staged cover edits (Manage Meetup)
 * ------------------------------------------------------------------ */

/**
 * Staged cover state in the Manage Meetup form.
 *  - "unchanged": keep whatever the Meetup currently has.
 *  - "removed":   persist NULL (canonical no-cover value, never "").
 *  - "replaced":  persist the processed data URL.
 */
export type CoverDraft =
  | { kind: "unchanged" }
  | { kind: "removed" }
  | { kind: "replaced"; dataUrl: string };

export const COVER_DRAFT_UNCHANGED: CoverDraft = { kind: "unchanged" };

/**
 * What the save call should send for this draft. `clearCover` is what allows a
 * removal to reach the row at all: `update_hosted_meetup` COALESCEs a NULL
 * cover argument to the existing value, so NULL alone means "leave as is".
 */
export function resolveCoverUpdate(draft: CoverDraft): {
  coverImageUrl: string | null;
  clearCover: boolean;
  dirty: boolean;
} {
  if (draft.kind === "removed") return { coverImageUrl: null, clearCover: true, dirty: true };
  if (draft.kind === "replaced") {
    return { coverImageUrl: draft.dataUrl, clearCover: false, dirty: true };
  }
  return { coverImageUrl: null, clearCover: false, dirty: false };
}

/** The image the cover section should preview, or null for the no-cover state. */
export function previewCover(draft: CoverDraft, currentCover: string | null): string | null {
  if (draft.kind === "removed") return null;
  if (draft.kind === "replaced") return draft.dataUrl;
  return currentCover;
}

/** True when the staged payload would be rejected by the server ceiling. */
export function exceedsCoverCeiling(draft: CoverDraft): boolean {
  return draft.kind === "replaced" && draft.dataUrl.length > MEETUP_COVER_MAX_CHARS;
}

/**
 * Member-safe copy for a failed cover save. Raw database / provider text is
 * never surfaced, and the message always states that the existing cover is
 * still intact — because the row update is atomic, so it is.
 */
export function coverSaveErrorMessage(error: unknown): string {
  const raw = (
    typeof error === "string" ? error : ((error as { message?: string } | null)?.message ?? "")
  ).toLowerCase();
  if (
    raw.includes("failed to fetch") ||
    raw.includes("networkerror") ||
    raw.includes("network request failed") ||
    raw.includes("load failed")
  ) {
    return "Your connection was interrupted. Check your internet connection and try again.";
  }
  if (raw.includes("too large")) {
    return "That cover photo is too large to attach. Choose a smaller image. Your current cover is still unchanged.";
  }
  if (raw.includes("isn’t supported") || raw.includes("isn't supported") || raw.includes("format")) {
    return "Choose a JPG, PNG, or WebP photo. Your current cover is still unchanged.";
  }
  return "We couldn’t update the Meetup cover. Your current cover is still unchanged.";
}

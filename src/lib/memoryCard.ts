/**
 * Memory card photo pipeline.
 *
 * Reuses the Meetup cover rules (JPEG data URL, bounded size, EXIF stripped
 * by canvas re-encoding) so the server validates both with the same regex and
 * ceilings. Produces two encodings: the full card photo and a small thumbnail
 * the collection grid uses so a profile with many cards stays light.
 */
import { isAllowedCoverFile, MEETUP_COVER_MAX_INPUT_BYTES } from "@/lib/meetupPublishErrors";

export const MEMORY_CARD_CAPTION_MAX = 80;
/** Full photo ceiling (server CHECK is 500,000). */
export const MEMORY_CARD_PHOTO_TARGET_CHARS = 460_000;
/** Thumbnail ceiling (server CHECK is 80,000). */
export const MEMORY_CARD_THUMB_TARGET_CHARS = 72_000;
export const MEMORY_CARD_MAX_INPUT_BYTES = MEETUP_COVER_MAX_INPUT_BYTES;

export const PHOTO_LADDER: ReadonlyArray<{ max: number; quality: number }> = [
  { max: 1280, quality: 0.8 },
  { max: 1280, quality: 0.65 },
  { max: 1024, quality: 0.6 },
  { max: 800, quality: 0.55 },
  { max: 640, quality: 0.5 },
];

export const THUMB_LADDER: ReadonlyArray<{ max: number; quality: number }> = [
  { max: 360, quality: 0.7 },
  { max: 320, quality: 0.6 },
  { max: 256, quality: 0.5 },
];

export type MemoryCardErrorCode = "UNSUPPORTED_TYPE" | "TOO_LARGE" | "PROCESSING_FAILED";

export const MEMORY_CARD_ERROR_COPY: Record<MemoryCardErrorCode, string> = {
  UNSUPPORTED_TYPE: "Choose a JPG, PNG, or WebP photo.",
  TOO_LARGE: "That photo is too large. Choose a smaller image.",
  PROCESSING_FAILED: "We couldn't prepare that photo. Try another image.",
};

export type MemoryCardProcessResult =
  | { status: "ok"; photoDataUrl: string; thumbDataUrl: string }
  | { status: "error"; code: MemoryCardErrorCode; message: string };

function fail(code: MemoryCardErrorCode): MemoryCardProcessResult {
  return { status: "error", code, message: MEMORY_CARD_ERROR_COPY[code] };
}

/** Clean a caption the way the server will store it. */
export function normalizeCaption(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MEMORY_CARD_CAPTION_MAX);
}

type Drawable = ImageBitmap | HTMLImageElement;

async function decode(file: File): Promise<{ img: Drawable; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { img: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
    } catch {
      /* fall back to <img> (e.g. HEIC on engines without bitmap support) */
    }
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = url;
  }).catch((e) => {
    URL.revokeObjectURL(url);
    throw e;
  });
  return { img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

/** Pure: draw at the ladder sizes until one fits the ceiling. */
export function encodeWithLadder(
  draw: (max: number, quality: number) => string,
  ladder: ReadonlyArray<{ max: number; quality: number }>,
  ceiling: number,
): string | null {
  for (const step of ladder) {
    const url = draw(step.max, step.quality);
    if (url.length <= ceiling) return url;
  }
  return null;
}

/** Validate, decode and encode a member-selected photo. Never throws. */
export async function processMemoryCardPhoto(file: File): Promise<MemoryCardProcessResult> {
  if (!isAllowedCoverFile(file)) return fail("UNSUPPORTED_TYPE");
  if (file.size > MEMORY_CARD_MAX_INPUT_BYTES) return fail("TOO_LARGE");

  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    return fail("PROCESSING_FAILED");
  }

  try {
    if (!decoded.width || !decoded.height) return fail("PROCESSING_FAILED");
    const draw = (max: number, quality: number) => {
      const scale = Math.min(1, max / Math.max(decoded.width, decoded.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(decoded.img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    };
    const photo = encodeWithLadder(draw, PHOTO_LADDER, MEMORY_CARD_PHOTO_TARGET_CHARS);
    if (!photo) return fail("TOO_LARGE");
    const thumb = encodeWithLadder(draw, THUMB_LADDER, MEMORY_CARD_THUMB_TARGET_CHARS);
    if (!thumb) return fail("TOO_LARGE");
    return { status: "ok", photoDataUrl: photo, thumbDataUrl: thumb };
  } catch {
    return fail("PROCESSING_FAILED");
  } finally {
    decoded.release();
  }
}

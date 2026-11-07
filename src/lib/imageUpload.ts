import { supabase } from "@/integrations/supabase/client";

/**
 * Raw file size we are willing to DECODE. The avatar is always re-encoded to a
 * ≤1024px JPEG below, so the original can be large; a modern phone photo is
 * routinely 5–15 MB and used to be rejected outright (and then surfaced as the
 * generic "Something went wrong" copy).
 */
export const MAX_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024; // 25 MB
/** Size of the re-encoded avatar actually stored. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AVATAR_SOURCE_MB = MAX_AVATAR_SOURCE_BYTES / (1024 * 1024);

export const ALLOWED_AVATAR_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
] as const;

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic|heif|gif)$/i;

export type ImageUploadErrorCode =
  | "mime"
  | "size"
  | "decode"
  | "canvas"
  | "encode"
  | "auth"
  | "upload"
  | "sign";

/**
 * Every message here is member-safe by construction and is shown verbatim by
 * `normalizeError` (see `src/lib/errors.ts`). Raw storage/API detail goes to
 * `cause` and the console only.
 */
export class ImageUploadError extends Error {
  /** Raw underlying error (storage/API detail). Never shown to members. */
  cause?: unknown;
  constructor(public code: ImageUploadErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ImageUploadError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export const IMAGE_UPLOAD_COPY = {
  mime: "Please choose a photo (JPG, PNG, WebP or HEIC).",
  size: `That photo is too large. Please choose one under ${MAX_AVATAR_SOURCE_MB} MB.`,
  decode: "We couldn't read that photo. Try a different one.",
  process: "We couldn't process that photo. Try a different one.",
  auth: "Please sign in first.",
  upload: "We couldn't upload your photo. Check your connection and try again.",
  sign: "Your photo was uploaded but we couldn't display it. Try again.",
} as const;

/**
 * Pure pre-flight check. Some pickers (iOS Files, some Android galleries)
 * report an empty `type`, so an empty type with an image extension is allowed
 * through — the decoder below is the real gate.
 */
export function validateAvatarFile(file: Pick<File, "type" | "size" | "name">): void {
  const type = (file.type || "").toLowerCase();
  const typeOk =
    (ALLOWED_AVATAR_MIME as readonly string[]).includes(type) ||
    (type === "" && IMAGE_EXT_RE.test(file.name || ""));
  if (!typeOk) throw new ImageUploadError("mime", IMAGE_UPLOAD_COPY.mime);
  if (file.size > MAX_AVATAR_SOURCE_BYTES) throw new ImageUploadError("size", IMAGE_UPLOAD_COPY.size);
}

type Drawable = ImageBitmap | HTMLImageElement;

/** Decode with createImageBitmap, falling back to <img> for older WebViews. */
async function decodeImage(file: File): Promise<{ img: Drawable; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { img: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
    } catch {
      /* fall through to the <img> path (e.g. HEIC on engines without bitmap support) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("img decode failed"));
      el.src = url;
    });
    return {
      img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (cause) {
    URL.revokeObjectURL(url);
    throw new ImageUploadError("decode", IMAGE_UPLOAD_COPY.decode, { cause });
  }
}

/**
 * Re-encode an image through a canvas to strip EXIF/GPS metadata and
 * downsize to a safe maximum. Returns a JPEG blob.
 */
export async function sanitizeImage(file: File, maxDim = 1024): Promise<Blob> {
  validateAvatarFile(file);

  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) {
      throw new ImageUploadError("decode", IMAGE_UPLOAD_COPY.decode);
    }
    const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageUploadError("canvas", IMAGE_UPLOAD_COPY.process);
    ctx.drawImage(decoded.img, 0, 0, w, h);

    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ImageUploadError("encode", IMAGE_UPLOAD_COPY.process))),
        "image/jpeg",
        0.9,
      ),
    );
    if (blob.size > MAX_AVATAR_BYTES) throw new ImageUploadError("size", IMAGE_UPLOAD_COPY.size);
    return blob;
  } finally {
    decoded.release();
  }
}

/**
 * Upload a sanitized avatar for the signed-in user. Path is
 * `<auth.uid()>/avatar-<ts>.jpg` so storage RLS enforces ownership.
 * Returns a signed URL usable for display.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new ImageUploadError("auth", IMAGE_UPLOAD_COPY.auth);
  const uid = userData.user.id;

  const blob = await sanitizeImage(file);
  const path = `${uid}/avatar-${Date.now()}.jpg`;

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
  if (upErr) {
    console.error("avatar upload failed", upErr);
    throw new ImageUploadError("upload", IMAGE_UPLOAD_COPY.upload, { cause: upErr });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed) {
    console.error("avatar signed url failed", signErr);
    throw new ImageUploadError("sign", IMAGE_UPLOAD_COPY.sign, { cause: signErr });
  }
  return signed.signedUrl;
}

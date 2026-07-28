import { supabase } from "@/integrations/supabase/client";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_AVATAR_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export class ImageUploadError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ImageUploadError";
  }
}

/**
 * Re-encode an image through a canvas to strip EXIF/GPS metadata and
 * downsize to a safe maximum. Returns a JPEG blob.
 */
export async function sanitizeImage(file: File, maxDim = 1024): Promise<Blob> {
  if (!ALLOWED_AVATAR_MIME.includes(file.type as (typeof ALLOWED_AVATAR_MIME)[number])) {
    throw new ImageUploadError("mime", "Please upload a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new ImageUploadError("size", "Image is too large. Max 5 MB.");
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new ImageUploadError("decode", "That file doesn't look like an image.");
  });

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageUploadError("canvas", "Couldn't process the image.");
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ImageUploadError("encode", "Couldn't process the image."))),
      "image/jpeg",
      0.9,
    ),
  );
  return blob;
}

/**
 * Upload a sanitized avatar for the signed-in user. Path is
 * `<auth.uid()>/avatar-<ts>.jpg` so storage RLS enforces ownership.
 * Returns a signed URL usable for display.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new ImageUploadError("auth", "Please sign in first.");
  const uid = userData.user.id;

  const blob = await sanitizeImage(file);
  const path = `${uid}/avatar-${Date.now()}.jpg`;

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
  if (upErr) throw new ImageUploadError("upload", upErr.message);

  const { data: signed, error: signErr } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed) throw new ImageUploadError("sign", signErr?.message ?? "Couldn't get a URL.");
  return signed.signedUrl;
}

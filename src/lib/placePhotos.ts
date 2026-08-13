import { supabase } from "@/integrations/supabase/client";

/**
 * WO-101 — Community Place photo management.
 *
 * Storage model
 * -------------
 * Photos live in the PRIVATE `community-place-photos` bucket under
 * `<community_place_id>/<uuid>.jpg`. The bucket is private because this
 * workspace blocks public buckets, so every display URL is a short-lived
 * signed URL created at read time. Signed URLs are NEVER persisted to the
 * database — `community_place_photos.storage_path` is the single source of
 * truth and `community_places.cover_image_url` remains a legacy column that
 * this feature does not write.
 *
 * Writes
 * ------
 * Every mutation goes through an owner-only SECURITY DEFINER RPC; the table
 * has no INSERT/UPDATE/DELETE policy. Uploads are also gated by a storage
 * policy that requires `is_owner()`, so a normal member cannot write files
 * even if the UI were reachable.
 */

export const PLACE_PHOTO_LIMIT = 8;
export const MAX_PLACE_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB source file
export const ALLOWED_PLACE_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export class PlacePhotoError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlacePhotoError";
  }
}

export interface PlacePhoto {
  id: string;
  community_place_id: string;
  storage_path: string;
  sort_order: number;
  is_cover: boolean;
  created_at: string;
  /** Short-lived signed URL for display. Never persisted. */
  url: string | null;
}

interface PhotoRow {
  id: string;
  community_place_id: string;
  storage_path: string;
  sort_order: number;
  is_cover: boolean;
  created_at: string;
}

/** Member-safe message for any failure surfaced by this module. */
export function placePhotoMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  if (/not authorized/i.test(raw)) return "Only the VeggieMeet owner can manage place photos.";
  if (/photo limit/i.test(raw)) return `A place can have at most ${PLACE_PHOTO_LIMIT} photos.`;
  if (/cover photo is always first/i.test(raw))
    return "The cover photo always appears first — choose a different cover to change the order.";
  if (/photo not found|not found/i.test(raw)) return "That photo is no longer available.";
  if (/invalid storage path/i.test(raw)) return "Couldn't store that photo. Please try again.";
  if (e instanceof PlacePhotoError) return e.message;
  return "Something went wrong. Please try again.";
}

/**
 * Re-encode through a canvas so EXIF/GPS metadata is stripped and the long
 * edge is bounded. Returns a JPEG blob.
 */
export async function sanitizePlacePhoto(file: File, maxDim = 1600): Promise<Blob> {
  if (!ALLOWED_PLACE_PHOTO_MIME.includes(file.type as (typeof ALLOWED_PLACE_PHOTO_MIME)[number])) {
    throw new PlacePhotoError("mime", "Please choose a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_PLACE_PHOTO_BYTES) {
    throw new PlacePhotoError("size", "That image is too large. Max 10 MB.");
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new PlacePhotoError("decode", "That file doesn't look like an image.");
  });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PlacePhotoError("canvas", "Couldn't process that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new PlacePhotoError("encode", "Couldn't process that image.")),
      "image/jpeg",
      0.82,
    ),
  );
}

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from("community-place-photos")
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  data.forEach((entry, i) => {
    const path = entry.path ?? paths[i];
    if (entry.signedUrl && path) out[path] = entry.signedUrl;
  });
  return out;
}

/** Ordered photos for one place, cover first, each with a fresh signed URL. */
export async function listPlacePhotos(placeId: string): Promise<PlacePhoto[]> {
  const { data, error } = await supabase
    .from("community_place_photos")
    .select("id, community_place_id, storage_path, sort_order, is_cover, created_at")
    .eq("community_place_id", placeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as PhotoRow[];
  const signed = await signPaths(rows.map((r) => r.storage_path));
  return rows.map((r) => ({ ...r, url: signed[r.storage_path] ?? null }));
}

/** Signed cover URL for a single place, or null when it has no photos yet. */
export async function fetchPlaceCoverUrl(placeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("community_place_photos")
    .select("storage_path")
    .eq("community_place_id", placeId)
    .eq("is_cover", true)
    .maybeSingle();
  if (error || !data?.storage_path) return null;
  const signed = await signPaths([data.storage_path]);
  return signed[data.storage_path] ?? null;
}

/**
 * Upload + register a photo. The file is uploaded first, then registered; if
 * registration is refused the uploaded object is removed so storage never
 * keeps an unreferenced file.
 */
export async function addPlacePhoto(placeId: string, file: File): Promise<void> {
  const blob = await sanitizePlacePhoto(file);
  const path = `${placeId}/${crypto.randomUUID()}.jpg`;

  const { error: upErr } = await supabase.storage
    .from("community-place-photos")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
  if (upErr) throw new PlacePhotoError("upload", "Couldn't upload that photo. Please try again.");

  const { error: rpcErr } = await supabase.rpc("add_community_place_photo", {
    _place_id: placeId,
    _storage_path: path,
  });
  if (rpcErr) {
    await supabase.storage.from("community-place-photos").remove([path]);
    throw rpcErr;
  }
}

export async function setPlacePhotoCover(photoId: string): Promise<void> {
  const { error } = await supabase.rpc("set_community_place_photo_cover", { _photo_id: photoId });
  if (error) throw error;
}

export async function movePlacePhoto(
  photoId: string,
  direction: "left" | "right",
): Promise<void> {
  const { error } = await supabase.rpc("move_community_place_photo", {
    _photo_id: photoId,
    _direction: direction,
  });
  if (error) throw error;
}

/**
 * Remove a photo. The database row goes first (it is what every member-facing
 * surface reads); the storage object is removed afterwards. A failed object
 * delete leaves an unreferenced file, which is invisible to members.
 */
export async function deletePlacePhoto(photoId: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_community_place_photo", {
    _photo_id: photoId,
  });
  if (error) throw error;
  const path = (data as { storage_path?: string } | null)?.storage_path;
  if (path) await supabase.storage.from("community-place-photos").remove([path]);
}

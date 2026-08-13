import { useQuery } from "@tanstack/react-query";
import { fetchPlaceCoverUrl, listPlacePhotos, type PlacePhoto } from "@/lib/placePhotos";

/**
 * WO-101 — signed display URLs are short-lived, so photo reads are cached for
 * less than their signed-URL lifetime (1 hour) and refetched afterwards.
 */
const STALE_MS = 25 * 60_000;

export function usePlacePhotos(placeId: string | undefined) {
  return useQuery<PlacePhoto[]>({
    queryKey: ["place-photos", placeId],
    queryFn: () => listPlacePhotos(placeId as string),
    enabled: !!placeId,
    staleTime: STALE_MS,
  });
}

/**
 * Cover photo for a card surface. Returns `undefined` while loading and `null`
 * when the place has no managed photos, so callers keep their existing
 * placeholder rather than flashing a broken image.
 */
export function usePlaceCoverUrl(placeId: string | undefined) {
  const q = useQuery<string | null>({
    queryKey: ["place-cover", placeId],
    queryFn: () => fetchPlaceCoverUrl(placeId as string),
    enabled: !!placeId,
    staleTime: STALE_MS,
  });
  return q.isPending ? undefined : (q.data ?? null);
}

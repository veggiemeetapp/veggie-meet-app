import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePlacePhotos } from "@/hooks/usePlacePhotos";
import { ProgressiveImage } from "@/components/app/ProgressiveImage";

interface Props {
  placeId: string;
  placeName: string;
}

/**
 * WO-101 — member-facing photo strip on Community Place detail. The cover is
 * rendered by the hero, so the gallery only appears when there is more than
 * one managed photo. Nothing renders while loading or on failure: photos are
 * enhancement, never a dependency of the page.
 */
export function PlacePhotoGallery({ placeId, placeName }: Props) {
  const { data } = usePlacePhotos(placeId);
  const [active, setActive] = useState(0);
  const photos = (data ?? []).filter((p) => !!p.url);

  if (photos.length < 2) return null;

  const current = photos[Math.min(active, photos.length - 1)];

  return (
    <section aria-label={`Photos of ${placeName}`} className="px-5 mt-5 min-w-0">
      <h2 className="text-sm font-semibold text-charcoal">Photos</h2>
      <div className="mt-2 rounded-card overflow-hidden bg-muted aspect-[4/3]">
        <ProgressiveImage
          src={current.url ?? ""}
          alt={`${placeName} photo ${Math.min(active, photos.length - 1) + 1} of ${photos.length}`}
          loading="lazy"
          containerClassName="w-full h-full"
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setActive((i) => Math.max(0, i - 1))}
          disabled={active <= 0}
          aria-label="Previous photo"
          className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-full bg-muted text-charcoal disabled:opacity-40"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden />
        </button>
        <p aria-live="polite" className="text-xs text-charcoal-muted">
          {Math.min(active, photos.length - 1) + 1} of {photos.length}
        </p>
        <button
          type="button"
          onClick={() => setActive((i) => Math.min(photos.length - 1, i + 1))}
          disabled={active >= photos.length - 1}
          aria-label="Next photo"
          className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-full bg-muted text-charcoal disabled:opacity-40"
        >
          <ChevronRight className="w-5 h-5" aria-hidden />
        </button>
      </div>
    </section>
  );
}

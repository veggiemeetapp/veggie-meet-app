import { useEffect, useState } from "react";
import { Utensils } from "lucide-react";

interface Props {
  /** Signed cover URL: `undefined` while loading, `null` when the place has none. */
  coverUrl: string | null | undefined;
  className?: string;
}

/**
 * WO-105 — shared cover media area for Community Place cards. The canonical
 * cover source is `community_place_photos` via `usePlaceCoverUrl` (signed URLs,
 * private bucket). `community_places.cover_image_url` is legacy and is never
 * read here. A transient image failure falls back to the branded placeholder
 * for that render only; a new signed URL clears the failure.
 */
export function PlaceCoverImage({ coverUrl, className }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [coverUrl]);

  if (!coverUrl || failed) {
    return (
      <div className={`w-full h-full bg-soft-green flex items-center justify-center ${className ?? ""}`}>
        <Utensils className="w-7 h-7 text-primary/70" aria-hidden />
      </div>
    );
  }

  return (
    <img
      src={coverUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`w-full h-full object-cover bg-muted ${className ?? ""}`}
    />
  );
}

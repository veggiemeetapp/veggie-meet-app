import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/app";
import { usePlacePhotos } from "@/hooks/usePlacePhotos";
import {
  ALLOWED_PLACE_PHOTO_MIME,
  PLACE_PHOTO_LIMIT,
  addPlacePhoto,
  deletePlacePhoto,
  movePlacePhoto,
  placePhotoMessage,
  setPlacePhotoCover,
} from "@/lib/placePhotos";
import { supabase } from "@/integrations/supabase/client";
import { logAnalyticsEvent } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";

/**
 * WO-101 — owner-only Community Place photo management.
 *
 * The route is already wrapped by the owner gate; every mutation is also
 * authorized server-side, so this screen is presentation only. Photo actions
 * touch nothing but photos: no verification, vegan status, coordinates,
 * check-ins or Meetups are read or written here.
 */
export default function OwnerPlacePhotos() {
  const { placeId = "" } = useParams();
  const [params] = useSearchParams();
  const from = params.get("from");
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const placeQ = useQuery({
    queryKey: ["owner-place-name", placeId],
    enabled: !!placeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("community_places")
        .select("id, name, is_active")
        .eq("id", placeId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const photosQ = usePlacePhotos(placeId);
  const photos = photosQ.data ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["place-photos", placeId] });
    qc.invalidateQueries({ queryKey: ["place-cover", placeId] });
  }

  function fail(e: unknown) {
    toast({ title: placePhotoMessage(e), variant: "destructive" });
  }

  const upload = useMutation({
    mutationFn: (file: File) => addPlacePhoto(placeId, file),
    onSuccess: () => {
      logAnalyticsEvent("place_photo_added", { place_id: placeId });
      toast({ title: "Photo added" });
      invalidate();
    },
    onError: fail,
  });

  const cover = useMutation({
    mutationFn: (id: string) => setPlacePhotoCover(id),
    onMutate: (id: string) => setBusyId(id),
    onSuccess: () => {
      logAnalyticsEvent("place_photo_cover_set", { place_id: placeId });
      toast({ title: "Cover photo updated" });
      invalidate();
    },
    onError: fail,
    onSettled: () => setBusyId(null),
  });

  const move = useMutation({
    mutationFn: (v: { id: string; direction: "left" | "right" }) =>
      movePlacePhoto(v.id, v.direction),
    onMutate: (v) => setBusyId(v.id),
    onSuccess: () => invalidate(),
    onError: fail,
    onSettled: () => setBusyId(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePlacePhoto(id),
    onMutate: (id: string) => setBusyId(id),
    onSuccess: () => {
      logAnalyticsEvent("place_photo_removed", { place_id: placeId });
      toast({ title: "Photo removed" });
      invalidate();
    },
    onError: fail,
    onSettled: () => setBusyId(null),
  });

  const atLimit = photos.length >= PLACE_PHOTO_LIMIT;

  return (
    <main role="main" className="flex flex-col min-h-dvh pb-24">
      <header className="safe-top px-4 pt-2 pb-3 flex items-center gap-2 min-w-0">
        <BackButton fallback={from === "owner_places" ? "/owner/places" : "/owner/places"} />
        <h1 className="text-lg font-semibold text-charcoal truncate min-w-0">Place photos</h1>
      </header>

      <div className="px-5 min-w-0 space-y-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-charcoal [overflow-wrap:anywhere]">
            {placeQ.data?.name ?? "Community Place"}
          </p>
          <p className="mt-1 text-xs text-charcoal-muted">
            {photos.length} of {PLACE_PHOTO_LIMIT} photos · the cover photo is what members see on
            cards and at the top of the place page.
          </p>
          <p className="mt-1 text-xs text-charcoal-muted [overflow-wrap:anywhere]">
            Only upload photos you have the right to publish. Location metadata is stripped before
            upload, and photos of identifiable members should not be published.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_PLACE_PHOTO_MIME.join(",")}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={atLimit || upload.isPending}
          className="w-full"
        >
          {upload.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          ) : (
            <ImagePlus className="w-4 h-4" aria-hidden />
          )}
          {atLimit ? "Photo limit reached" : "Add photos"}
        </Button>

        {photosQ.isPending && <p className="text-sm text-charcoal-muted">Loading photos…</p>}
        {photosQ.isError && (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load photos. Please try again.
          </p>
        )}

        {!photosQ.isPending && photos.length === 0 && (
          <p className="text-sm text-charcoal-muted">
            No photos yet. The place page shows a neutral placeholder until you add one.
          </p>
        )}

        <ul className="space-y-3">
          {photos.map((p, i) => (
            <li
              key={p.id}
              className="rounded-card border border-border overflow-hidden bg-card min-w-0"
            >
              <div className="relative">
                {p.url ? (
                  <img
                    src={p.url}
                    alt={`Photo ${i + 1}`}
                    loading="lazy"
                    className="w-full aspect-[4/3] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[4/3] bg-muted" />
                )}
                {p.is_cover && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-background/90 text-primary">
                    Cover
                  </span>
                )}
              </div>
              <div className="p-3 flex flex-wrap items-center gap-2 min-w-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={p.is_cover || busyId === p.id}
                  onClick={() => cover.mutate(p.id)}
                >
                  <Star className="w-4 h-4" aria-hidden />
                  Set as cover
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Move photo ${i + 1} earlier`}
                  disabled={p.is_cover || i <= 1 || busyId === p.id}
                  onClick={() => move.mutate({ id: p.id, direction: "left" })}
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Move photo ${i + 1} later`}
                  disabled={p.is_cover || i >= photos.length - 1 || busyId === p.id}
                  onClick={() => move.mutate({ id: p.id, direction: "right" })}
                >
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  disabled={busyId === p.id}
                  onClick={() => {
                    if (
                      window.confirm(
                        p.is_cover && photos.length > 1
                          ? "Remove this cover photo? The next photo becomes the cover."
                          : "Remove this photo? This can't be undone.",
                      )
                    )
                      remove.mutate(p.id);
                  }}
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

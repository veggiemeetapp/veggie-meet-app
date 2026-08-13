import { useMemo, useState } from "react";
import { Leaf, Loader2, MapPin, Search } from "lucide-react";
import { usePlaceCoverUrl } from "@/hooks/usePlacePhotos";
import { cn } from "@/lib/utils";
import type { CommunityPlace } from "@/types";

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  fully_vegan: "100% Vegan",
  fully_vegetarian: "100% Vegetarian",
  vegetarian_friendly: "Vegetarian Friendly",
  vegan_options: "Vegan Options",
  not_food: "Community Space",
};

export interface CommunityPlacePickerProps {
  places: CommunityPlace[];
  loading: boolean;
  errored: boolean;
  onRetry: () => void;
  selectedPlaceId: string | null;
  onSelect: (place: CommunityPlace) => void;
  onUseCustom: () => void;
  onSuggestPlace: () => void;
  onViewPlace: (placeId: string) => void;
}

/**
 * WO-051 — Community Place selector for the Host flow.
 * Presentation only: the caller owns state, and the server re-validates every
 * selected place id (published + verified + active + operational + same city).
 */
export function CommunityPlacePicker({
  places,
  loading,
  errored,
  onRetry,
  selectedPlaceId,
  onSelect,
  onUseCustom,
  onSuggestPlace,
  onViewPlace,
}: CommunityPlacePickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return places;
    return places.filter((p) => p.name.toLowerCase().includes(q));
  }, [places, query]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-charcoal-muted" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading Community Places…
      </div>
    );
  }

  if (errored) {
    return (
      <div className="rounded-card border border-border bg-muted/30 p-4 text-center">
        <p className="text-sm font-semibold text-charcoal">
          We couldn’t load Community Places
        </p>
        <p className="mt-1 text-xs text-charcoal-muted">Try again in a moment.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (places.length === 0) {
    return (
      <div className="rounded-card border border-border bg-muted/30 p-4 text-center">
        <p className="text-sm font-semibold text-charcoal">
          No Community Places available yet
        </p>
        <p className="mt-1 text-xs text-charcoal-muted">
          Choose a custom location, or suggest a 100% vegan place for review.
        </p>
        <div className="mt-3 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={onUseCustom}
            className="h-10 px-4 rounded-control border border-border bg-card text-sm font-semibold text-charcoal"
          >
            Use a Custom Location
          </button>
          <button
            type="button"
            onClick={onSuggestPlace}
            className="h-10 px-4 rounded-control bg-primary text-primary-foreground text-sm font-semibold"
          >
            Suggest a Place
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs text-charcoal-muted">
        Meet at a verified 100% vegan place in the VeggieMeet community.
      </p>

      <div>
        <label
          htmlFor="host-place-search"
          className="block text-xs font-semibold text-charcoal mb-1.5"
        >
          Search Community Places
        </label>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-muted"
            aria-hidden
          />
          <input
            id="host-place-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full h-11 rounded-control border border-border bg-card pl-9 pr-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* WO-085A DEF-085A-03: role="radiogroup" strips list semantics, so
          <li> children were orphaned listitems. Plain divs keep the radio
          group intact without an invalid list. */}
      <div className="space-y-2" role="radiogroup" aria-label="Community Place">
        {filtered.map((p) => {
          const active = selectedPlaceId === p.id;
          const dietary = CLASSIFICATION_LABEL[p.veggieClassification ?? ""] ?? null;
          const category = CATEGORY_LABEL[p.category] ?? "Venue";
          return (
            <div key={p.id} className="min-w-0">
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(p)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 rounded-card border text-left transition-all overflow-hidden",
                  active
                    ? "border-primary bg-accent/40 shadow-sm"
                    : "border-border bg-card hover:bg-accent/30",
                )}
              >
                <PickerCover placeId={p.id} />
                <span className="min-w-0 flex-1 block">
                  <span className="block font-semibold text-charcoal line-clamp-2 [overflow-wrap:anywhere]">
                    {p.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-charcoal-muted min-w-0">
                    <MapPin className="w-3 h-3 shrink-0" aria-hidden />
                    <span className="line-clamp-2 [overflow-wrap:anywhere]">
                      {[p.neighborhood, p.address].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {dietary && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-soft-green text-primary">
                        <Leaf className="w-2.5 h-2.5" aria-hidden />
                        {dietary}
                      </span>
                    )}
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-charcoal">
                      {category}
                    </span>
                    {active && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-primary-foreground">
                        Selected
                      </span>
                    )}
                  </span>
                </span>
              </button>
              {active && (
                <button
                  type="button"
                  onClick={() => onViewPlace(p.id)}
                  className="mt-1 ml-1 text-xs font-semibold text-primary"
                >
                  View Place
                </button>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-charcoal-muted">
            No Community Places match “{query.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * WO-101 — owner-managed cover thumbnail for a place row, with a neutral
 * placeholder while loading or when the place has no photos yet.
 */
function PickerCover({ placeId }: { placeId: string }) {
  const coverUrl = usePlaceCoverUrl(placeId);
  if (!coverUrl) {
    return (
      <span className="w-14 h-14 rounded-control bg-soft-green flex items-center justify-center shrink-0">
        <Leaf className="w-5 h-5 text-primary/70" aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={coverUrl}
      alt=""
      loading="lazy"
      className="w-14 h-14 rounded-control object-cover shrink-0 bg-muted"
    />
  );
}

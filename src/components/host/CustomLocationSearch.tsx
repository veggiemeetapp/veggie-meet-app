import { useState } from "react";
import { ExternalLink, Loader2, MapPin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchMeetupPlaces, type MeetupPlaceResult } from "@/lib/meetupPlaceSearch";

/**
 * WO-123B — only canonical Google Maps links returned by the server-side Places
 * details response are ever rendered. Anything else (manual entry, legacy rows,
 * unexpected schemes/hosts) renders no link at all.
 */
function safeMapsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    const ok =
      host === "maps.google.com" ||
      host === "www.google.com" ||
      host === "google.com" ||
      host === "goo.gl" ||
      host === "maps.app.goo.gl" ||
      /^(www\.)?google\.[a-z.]+$/.test(host);
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

function MapsLink({ url, placeName }: { url: string; placeName: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={placeName ? `View ${placeName} on Google Maps` : "View on Google Maps"}
      className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    >
      View on Google Maps
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
    </a>
  );
}


export interface CustomLocationValue {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  googlePlaceId: string | null;
  googleMapsUrl: string | null;
}

export interface CustomLocationSearchProps {
  value: CustomLocationValue;
  onChange: (next: CustomLocationValue) => void;
  /** ISO-3166 alpha-2 region used to bias results (city country). */
  region?: string | null;
  /** Fired once per executed search / selection / manual switch. */
  onEvent?: (event: "searched" | "selected" | "manual", detail?: Record<string, unknown>) => void;
}

/**
 * WO-123 — Google Places search-and-select for a Meetup custom location.
 *
 * Coordinates and the Google reference are captured silently from the selected
 * result; hosts never see or type latitude/longitude. Manual entry stays
 * available as a fallback when a place isn't listed.
 */
export function CustomLocationSearch({
  value,
  onChange,
  region,
  onEvent,
}: CustomLocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MeetupPlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const hasSelection = value.googlePlaceId !== null;

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    setError(null);
    try {
      const found = await searchMeetupPlaces(q, region);
      setResults(found);
      onEvent?.("searched", { result_count: found.length });
    } catch {
      setError("We couldn’t search places right now. Try again, or enter the location manually.");
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  function select(r: MeetupPlaceResult) {
    onChange({
      name: r.name,
      address: r.address ?? "",
      latitude: r.latitude,
      longitude: r.longitude,
      googlePlaceId: r.placeId,
      googleMapsUrl: r.googleMapsUrl,
    });
    setResults(null);
    setQuery("");
    setManual(false);
    onEvent?.("selected", { has_coordinates: r.latitude !== null });
  }

  function clearSelection() {
    onChange({
      name: "",
      address: "",
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      googleMapsUrl: null,
    });
  }

  const selectedMapsUrl = safeMapsUrl(value.googleMapsUrl);

  if (hasSelection) {
    return (
      <div className="mt-2 rounded-card border border-primary bg-accent/30 p-3">
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-charcoal [overflow-wrap:anywhere]">{value.name}</p>
            {value.address && (
              <p className="mt-0.5 text-xs text-charcoal-muted [overflow-wrap:anywhere]">
                {value.address}
              </p>
            )}
            {selectedMapsUrl && (
              <p className="mt-1.5">
                <MapsLink url={selectedMapsUrl} placeName={value.name} />
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-charcoal-muted">
              Location confirmed from Google Maps. Timezone comes from the city.
            </p>

          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            <X className="w-3 h-3" aria-hidden />
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-card border border-border bg-muted/30 p-3">
      <div>
        <label
          htmlFor="custom-location-search"
          className="block text-sm font-semibold text-charcoal mb-2"
        >
          Search for a place
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-muted"
              aria-hidden
            />
            <input
              id="custom-location-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Café, park or restaurant name"
              className="w-full h-11 rounded-control border border-border bg-card pl-9 pr-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={query.trim().length < 2 || searching}
            className={cn(
              "h-11 px-4 rounded-control text-sm font-semibold shrink-0",
              query.trim().length < 2 || searching
                ? "bg-muted text-charcoal-muted"
                : "bg-primary text-primary-foreground",
            )}
          >
            {searching ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-label="Searching" />
            ) : (
              "Search"
            )}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {results !== null && results.length === 0 && !searching && (
        <p className="text-xs text-charcoal-muted">
          No places matched that search. Try a different name, or enter the location manually.
        </p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="space-y-2" aria-label="Place search results">
          {results.map((r) => {
            const mapsUrl = safeMapsUrl(r.googleMapsUrl);
            return (
              <li
                key={r.placeId}
                className="rounded-card border border-border bg-card overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => select(r)}
                  className="w-full flex items-start gap-2 p-3 text-left hover:bg-accent/30"
                >
                  <MapPin className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 block">
                    <span className="block font-semibold text-charcoal [overflow-wrap:anywhere]">
                      {r.name}
                    </span>
                    {r.address && (
                      <span className="block mt-0.5 text-xs text-charcoal-muted [overflow-wrap:anywhere]">
                        {r.address}
                      </span>
                    )}
                    {r.businessStatus === "CLOSED_TEMPORARILY" && (
                      <span className="block mt-1 text-[11px] font-semibold text-destructive">
                        Temporarily closed on Google
                      </span>
                    )}
                  </span>
                </button>
                {mapsUrl && (
                  <div className="px-3 pb-3 -mt-1">
                    <MapsLink url={mapsUrl} placeName={r.name} />
                  </div>
                )}
              </li>
            );
          })}

        </ul>
      )}

      {!manual ? (
        <button
          type="button"
          onClick={() => {
            setManual(true);
            onEvent?.("manual");
          }}
          className="text-xs font-semibold text-primary"
        >
          Can’t find it? Enter the location manually
        </button>
      ) : (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <label
              htmlFor="custom-location-name"
              className="block text-sm font-semibold text-charcoal mb-2"
            >
              Location name
            </label>
            <input
              id="custom-location-name"
              type="text"
              value={value.name}
              onChange={(e) =>
                onChange({
                  ...value,
                  name: e.target.value,
                  latitude: null,
                  longitude: null,
                  googlePlaceId: null,
                  googleMapsUrl: null,
                })
              }
              placeholder="e.g. Riverside Park pavilion"
              className="w-full h-11 rounded-control border border-border bg-card px-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label
              htmlFor="custom-location-address"
              className="block text-sm font-semibold text-charcoal mb-2"
            >
              Street address
            </label>
            <input
              id="custom-location-address"
              type="text"
              value={value.address}
              onChange={(e) => onChange({ ...value, address: e.target.value })}
              placeholder="Street, District, City"
              className="w-full h-11 rounded-control border border-border bg-card px-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <p className="text-[11px] text-charcoal-muted">
            Timezone is set from the city automatically.
          </p>
        </div>
      )}
    </div>
  );
}

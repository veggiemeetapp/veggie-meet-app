import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, MapPin, Search, X } from "lucide-react";
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

/**
 * Manual name/address fields. Used both as the "can't find it" fallback while
 * searching and as the edit form for an already-saved custom location (WO-134).
 *
 * WO-148 — these fields edit a LOCAL draft only, and a name/address change
 * never touches the structured place data (coordinates, provider place id,
 * Maps link). Structured data is replaced only by picking a different place.
 */
function ManualLocationFields({
  value,
  onChange,
}: {
  value: CustomLocationValue;
  onChange: (next: CustomLocationValue) => void;
}) {
  return (
    <div className="space-y-3">
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
          onChange={(e) => onChange({ ...value, name: e.target.value })}
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
  /** Selected-city centre used to rank nearby matches ahead of distant ones. */
  biasLatitude?: number | null;
  biasLongitude?: number | null;
  /** Fired once per executed search / selection / manual switch. */
  onEvent?: (event: "searched" | "selected" | "manual", detail?: Record<string, unknown>) => void;
}

const AUTO_SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LENGTH = 2;
const SEARCH_CACHE_LIMIT = 20;

const EMPTY: CustomLocationValue = {
  name: "",
  address: "",
  latitude: null,
  longitude: null,
  googlePlaceId: null,
  googleMapsUrl: null,
};

/**
 * WO-123 — Google Places search-and-select for a Meetup custom location.
 * WO-148 — the view mode is driven by explicit member actions and a local
 * draft, never by the committed value. This is what makes multi-character
 * typing possible (the editor cannot re-render itself away after one keystroke),
 * keeps the saved location visible while editing, and keeps map data intact for
 * a name-only edit.
 */
export function CustomLocationSearch({
  value,
  onChange,
  region,
  biasLatitude,
  biasLongitude,
  onEvent,
}: CustomLocationSearchProps) {
  const hasSaved = value.name.trim().length > 0;
  /**
   * "view"   — a saved location exists and is shown read-only.
   * "edit"   — editing name/address of the saved location in a local draft.
   * "search" — searching for a (different) place; manual entry available.
   */
  const [mode, setMode] = useState<"view" | "edit" | "search">(
    hasSaved ? "view" : "search",
  );
  const [draft, setDraft] = useState<CustomLocationValue>(value);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MeetupPlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const cacheRef = useRef(new Map<string, MeetupPlaceResult[]>());
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  /**
   * DEF-148-02 — when a saved location arrives after mount (async Meetup load)
   * show it instead of the search-first state. Never while the member is
   * mid-edit or mid-search, so a draft is never discarded underneath them.
   */
  useEffect(() => {
    if (hasSaved && mode === "search" && !manual && results === null && query === "") {
      setMode("view");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSaved]);

  const googleConfirmed = value.googlePlaceId !== null;

  const runSearch = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (q.length < MIN_SEARCH_LENGTH) return;

    abortRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    const cacheKey = [
      (region ?? "VN").toUpperCase(),
      biasLatitude ?? "",
      biasLongitude ?? "",
      q.toLowerCase(),
    ].join(":");
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      abortRef.current = null;
      setError(null);
      setSearching(false);
      setResults(cached);
      onEventRef.current?.("searched", { result_count: cached.length, cached: true });
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const found = await searchMeetupPlaces(q, region, {
        signal: controller.signal,
        latitude: biasLatitude,
        longitude: biasLongitude,
      });
      // A slower response for an older query must never replace the latest list.
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (cacheRef.current.size >= SEARCH_CACHE_LIMIT) {
        const oldest = cacheRef.current.keys().next().value;
        if (oldest !== undefined) cacheRef.current.delete(oldest);
      }
      cacheRef.current.set(cacheKey, found);
      setResults(found);
      onEventRef.current?.("searched", { result_count: found.length });
    } catch {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setError("We couldn’t search places right now. Try again, or enter the location manually.");
      setResults(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setSearching(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  }, [biasLatitude, biasLongitude, region]);

  /**
   * Search automatically after a short typing pause. Abort immediately when the
   * query changes, both to save network work and to prevent stale-result flashes.
   */
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    setSearching(false);

    if (mode !== "search" || manual) return;
    const q = query.trim();
    setError(null);
    setResults(null);
    if (q.length < MIN_SEARCH_LENGTH) return;

    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void runSearch(q);
    }, AUTO_SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [manual, mode, query, runSearch]);

  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  /** Explicit selection of a genuinely different place — replaces structured data. */
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
    setDraftError(null);
    setMode("view");
    onEvent?.("selected", { has_coordinates: r.latitude !== null });
  }

  /** Commit the local draft (manual entry or a name/address edit). */
  function commitDraft() {
    if (draft.name.trim().length === 0) {
      setDraftError("Add a location name so attendees know where to go.");
      return;
    }
    setDraftError(null);
    onChange({ ...draft, name: draft.name.trim(), address: draft.address.trim() });
    setManual(false);
    setResults(null);
    setQuery("");
    setMode("view");
  }

  const selectedMapsUrl = safeMapsUrl(value.googleMapsUrl);

  // ---- Saved location, read-only view ------------------------------------
  if (mode === "view" && hasSaved) {
    return (
      <div className="mt-2 rounded-card border border-primary bg-accent/30 p-3">
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-muted">
              Current location
            </p>
            <p className="font-semibold text-charcoal [overflow-wrap:anywhere]">{value.name}</p>
            {value.address ? (
              <p className="mt-0.5 text-xs text-charcoal-muted [overflow-wrap:anywhere]">
                {value.address}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-charcoal-muted">No street address saved yet.</p>
            )}
            {selectedMapsUrl && (
              <p className="mt-1.5">
                <MapsLink url={selectedMapsUrl} placeName={value.name} />
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-charcoal-muted">
              {googleConfirmed
                ? "Location confirmed from Google Maps. Timezone comes from the city."
                : "Saved as a custom location. Timezone comes from the city."}
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft(value);
                setDraftError(null);
                setMode("edit");
                onEvent?.("manual", { mode: "edit_saved" });
              }}
              aria-label={
                value.name
                  ? `Edit ${value.name} name and address`
                  : "Edit location name and address"
              }
              className="mt-2 min-h-11 inline-flex items-center text-xs font-semibold text-primary"
            >
              Edit name or address
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setManual(false);
              setResults(null);
              setQuery("");
              setDraftError(null);
              setMode("search");
            }}
            aria-label="Change location — search for a different place"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            <X className="w-3 h-3" aria-hidden />
            Change
          </button>
        </div>
      </div>
    );
  }

  // ---- Editing name / address of the saved location (local draft) ---------
  if (mode === "edit") {
    return (
      <div className="mt-2 rounded-card border border-primary bg-accent/30 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-muted">
          Editing location details
        </p>
        <p className="mt-0.5 text-[11px] text-charcoal-muted">
          The saved location stays as it is until you save these details. Coordinates and the
          map pin are kept.
        </p>
        <div className="mt-3">
          <ManualLocationFields value={draft} onChange={setDraft} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={commitDraft}
            className="min-h-11 px-4 rounded-control text-sm font-semibold bg-primary text-primary-foreground"
          >
            Save location details
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setDraftError(null);
              setMode("view");
            }}
            className="min-h-11 px-4 rounded-control text-sm font-semibold border border-border bg-card text-charcoal"
          >
            Cancel
          </button>
        </div>
        {draftError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {draftError}
          </p>
        )}
      </div>
    );
  }

  // ---- Search for a place (saved location, if any, is left untouched) -----
  return (
    <div className="mt-2 space-y-3 rounded-card border border-border bg-muted/30 p-3">
      {hasSaved && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-card px-3 py-2">
          <p className="text-xs text-charcoal-muted min-w-0 [overflow-wrap:anywhere]">
            Still saved: <span className="font-semibold text-charcoal">{value.name}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              setManual(false);
              setResults(null);
              setQuery("");
              setMode("view");
            }}
            className="min-h-11 inline-flex items-center text-xs font-semibold text-primary"
          >
            Keep current location
          </button>
        </div>
      )}

      <div>
        <label
          htmlFor="custom-location-search"
          className="block text-sm font-semibold text-charcoal mb-2"
        >
          Search for a place
        </label>
        <div>
          <div className="relative min-w-0">
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
                  const q = query.trim();
                  if (q.length < MIN_SEARCH_LENGTH) return;
                  if (debounceRef.current !== null) {
                    window.clearTimeout(debounceRef.current);
                    debounceRef.current = null;
                  }
                  void runSearch(q);
                }
              }}
              placeholder="Place name or street address"
              autoComplete="off"
              aria-controls="custom-location-results"
              aria-describedby="custom-location-search-status"
              aria-busy={searching}
              className="w-full h-11 rounded-control border border-border bg-card pl-9 pr-10 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {searching && (
              <Loader2
                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary"
                aria-hidden
              />
            )}
          </div>
          <p
            id="custom-location-search-status"
            role="status"
            aria-live="polite"
            className="mt-1.5 text-[11px] text-charcoal-muted"
          >
            {searching
              ? "Searching nearby places…"
              : query.trim().length > 0 && query.trim().length < MIN_SEARCH_LENGTH
                ? `Type at least ${MIN_SEARCH_LENGTH} characters.`
                : "Results update automatically as you type."}
          </p>
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
        <ul id="custom-location-results" className="space-y-2" aria-label="Place search results">
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
            setDraft(hasSaved ? value : EMPTY);
            setDraftError(null);
            setManual(true);
            onEvent?.("manual");
          }}
          className="text-xs font-semibold text-primary"
        >
          Can’t find it? Enter the location manually
        </button>
      ) : (
        <div className="border-t border-border pt-3">
          <ManualLocationFields value={draft} onChange={setDraft} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={commitDraft}
              className="min-h-11 px-4 rounded-control text-sm font-semibold bg-primary text-primary-foreground"
            >
              Use this location
            </button>
            <button
              type="button"
              onClick={() => {
                setManual(false);
                setDraft(value);
                setDraftError(null);
                if (hasSaved) setMode("view");
              }}
              className="min-h-11 px-4 rounded-control text-sm font-semibold border border-border bg-card text-charcoal"
            >
              Cancel
            </button>
          </div>
          {draftError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {draftError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

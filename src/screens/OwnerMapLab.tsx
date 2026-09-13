import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Users } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchMapLabData, type MapLabMeetup, type MapLabPlace } from "@/lib/mapLab";
import { useLocationContext } from "@/hooks/useLocation";
import {
  meetupMarkerEmoji,
  placeStickerGroup,
  PLACE_STICKER_PLACEHOLDERS,
} from "@/lib/mapMarkers";

/**
 * WO-152 — PRIVATE, NON-NAVIGABLE technical proof of concept.
 *
 * Owner-only (`RequireOwner` + server-side `is_owner()` inside the RPC), not
 * linked from navigation, excluded from crawlers by `robots.txt` (`/owner/`),
 * and read-only. It exists to prove the map architecture, not to ship a
 * product surface: marker styles are temporary, there are no Veggie markers,
 * and the "Veggies nearby" pill is a static layout mock with no member data.
 *
 * Provider note: the prototype renders with MapLibre GL JS over OpenStreetMap
 * raster tiles so no vendor token is committed. MapLibre is API-compatible with
 * Mapbox GL JS, so WO-153 swaps the style + a restricted public Mapbox token in
 * one place without rewriting this screen.
 */

type Filter = "all" | "meetups" | "places";

type Selection =
  | { kind: "meetup"; item: MapLabMeetup }
  | { kind: "place"; item: MapLabPlace }
  | null;

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

export default function OwnerMapLab() {
  const location = useLocationContext();
  const cityId = location.data?.selected_city?.id ?? null;
  const [filter, setFilter] = useState<Filter>("all");
  const [selection, setSelection] = useState<Selection>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);

  const dataQ = useQuery({
    queryKey: ["owner-map-lab", cityId],
    queryFn: () => fetchMapLabData(cityId),
    enabled: !location.isPending,
    staleTime: 60_000,
  });

  const center = useMemo<[number, number]>(() => {
    const c = dataQ.data?.city;
    if (c?.longitude != null && c?.latitude != null) return [c.longitude, c.latitude];
    return [106.7009, 10.7769];
  }, [dataQ.data?.city]);

  // Create the map once the container is mounted. Library is loaded on demand so
  // it never lands in any other route's chunk.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!containerRef.current || mapRef.current) return;
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !containerRef.current) return;
        mapRef.current = new maplibre.Map({
          container: containerRef.current,
          style: OSM_STYLE,
          center,
          zoom: 11.5,
          attributionControl: { compact: true },
        });
        mapRef.current.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      } catch (e) {
        setMapError(e instanceof Error ? e.message : "Map failed to load");
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove?.();
      mapRef.current = null;
    };
    // Center is applied separately; the map is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setCenter?.(center);
  }, [center]);

  // Render markers whenever data or the filter changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!map || !dataQ.data) return;
      const maplibre = await import("maplibre-gl");
      if (cancelled) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const add = (lng: number, lat: number, glyph: string, ring: string, onClick: () => void) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className =
          `grid h-9 w-9 place-items-center rounded-full border-2 ${ring} bg-card text-base shadow-md`;
        el.textContent = glyph;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onClick();
        });
        markersRef.current.push(
          new maplibre.Marker({ element: el }).setLngLat([lng, lat]).addTo(map),
        );
      };

      if (filter !== "places") {
        for (const m of dataQ.data.meetups) {
          add(m.longitude, m.latitude, meetupMarkerEmoji(m.primary_interest_id), "border-primary", () =>
            setSelection({ kind: "meetup", item: m }),
          );
        }
      }
      if (filter !== "meetups") {
        for (const p of dataQ.data.places) {
          const glyph = PLACE_STICKER_PLACEHOLDERS[placeStickerGroup(p.category)];
          add(p.longitude, p.latitude, glyph, "border-charcoal-muted", () =>
            setSelection({ kind: "place", item: p }),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataQ.data, filter]);

  const cityName = dataQ.data?.city?.name ?? "your city";

  return (
    <div className="relative min-h-dvh">
      <div className="page-x flex items-center gap-2 pt-4">
        <Link
          to="/owner/places"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-charcoal-muted hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Owner operations
        </Link>
      </div>
      <div className="page-x mt-1">
        <h1 className="text-lg font-semibold text-charcoal">Map lab — internal prototype</h1>
        <p className="mt-1 text-sm text-charcoal-muted copy">
          WO-152 architecture proof for {cityName}. Temporary markers, no member data, not linked
          from navigation.
        </p>
      </div>

      {/* Mock only — no member data is queried for this pill. */}
      <div className="page-x mt-3 flex flex-wrap items-center gap-2">
        <span
          aria-disabled
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium text-charcoal-muted"
        >
          <Users className="h-4 w-4" /> Veggies nearby › <em className="not-italic">(layout mock)</em>
        </span>
      </div>

      <div className="page-x mt-3 flex gap-2" role="group" aria-label="Map layers">
        {(["all", "meetups", "places"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium capitalize ${
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-charcoal"
            }`}
          >
            {f === "all" ? "All" : f === "meetups" ? "Meetups" : "Community Places"}
          </button>
        ))}
      </div>

      <div className="page-x mt-3">
        <div
          ref={containerRef}
          data-testid="map-lab-canvas"
          aria-label="Prototype map canvas"
          className="h-[60vh] w-full overflow-hidden rounded-2xl bg-muted"
        />
        {(mapError || dataQ.error) && (
          <p className="mt-2 text-sm text-destructive">
            {mapError ?? "Map data failed to load."} Community remains the list alternative.
          </p>
        )}
        <p className="mt-2 text-xs text-charcoal-muted">
          {dataQ.data
            ? `${dataQ.data.meetups.length} Meetups and ${dataQ.data.places.length} Community Places with usable coordinates.`
            : "Loading prototype data…"}
        </p>
      </div>

      {selection && (
        <div className="page-x mt-3 pb-10">
          <div className="rounded-2xl border border-border bg-card p-4">
            {selection.kind === "meetup" ? (
              <>
                <p className="text-xs text-charcoal-muted">
                  Meetup · {selection.item.primary_interest_id ?? "no main interest"} ·{" "}
                  {selection.item.coordinate_origin}
                </p>
                <h2 className="mt-1 font-semibold text-charcoal">{selection.item.title}</h2>
                <p className="mt-1 text-sm text-charcoal-muted">
                  {selection.item.date} · {selection.item.start_time} ·{" "}
                  {selection.item.location_name ?? "—"}
                </p>
                <Link
                  to={`/meetup/${selection.item.id}`}
                  className="mt-3 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                >
                  View Meetup
                </Link>
              </>
            ) : (
              <>
                <p className="text-xs text-charcoal-muted">
                  Community Place · {placeStickerGroup(selection.item.category)} ·{" "}
                  {selection.item.veggie_classification ?? "—"}
                </p>
                <h2 className="mt-1 font-semibold text-charcoal">{selection.item.name}</h2>
                <p className="mt-1 text-sm text-charcoal-muted">{selection.item.address ?? "—"}</p>
                <Link
                  to={`/place/${selection.item.id}`}
                  className="mt-3 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                >
                  View Place
                </Link>
              </>
            )}
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="mt-2 block min-h-11 text-sm text-charcoal-muted hover:text-primary"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

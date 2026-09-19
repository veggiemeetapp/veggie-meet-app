import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { List, Users, WifiOff } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  fetchMemberMapData,
  type MemberMapMeetup,
  type MemberMapPlace,
} from "@/lib/memberMap";
import { fetchFeaturedPlaceIds } from "@/lib/mapLab";
import { fetchNearbyVeggiesByCity, type NearbyVeggie } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext } from "@/hooks/useLocation";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { logAnalyticsEvent } from "@/lib/analytics";
import { UserAvatar } from "@/components/app/UserAvatar";
import { MeetupMapSheetContent } from "@/components/map/MeetupMapSheetContent";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  meetupMarkerEmoji,
  placeStickerGroup,
  PLACE_STICKER_PLACEHOLDERS,
} from "@/lib/mapMarkers";
import { clusterMarkerElement, pointMarkerElement } from "@/lib/mapMarkerElements";
import {
  CITY_OVERVIEW_ZOOM,
  CLUSTER_CONFIG,
  MAPBOX_PUBLIC_TOKEN,
  MAPBOX_STYLE,
  UNAUTHORIZED_FALLBACK_STYLE,
  directionsHref,
  nearbyVeggieCountLabel,
  prefersReducedMotion,
  veggieCountLabel,
  veggieEmptyCopy,
  webglSupported,
} from "@/lib/mapPrototype";

/**
 * WO-154 — the real member-facing VeggieMeet Map, built from the founder-approved
 * WO-153C visual direction and shipped PRIVATELY behind `has_map_access()`.
 *
 * Scope guarantees:
 *  - PRODUCTION DATA ONLY. No fixtures, no density tools, no prototype chrome.
 *  - Today is not replaced and bottom navigation is unchanged; the Map is entered
 *    from Today/Community links that appear only for granted members.
 *  - Privacy (WO-152 Option A) is unchanged: Veggies appear only in the
 *    city-level pill and sheet, never as markers. No coordinates, distance,
 *    presence or GPS permission are read for members.
 */

type Filter = "all" | "meetups" | "places";

type Selection =
  | { kind: "meetup"; item: MemberMapMeetup }
  | { kind: "place"; item: MemberMapPlace }
  | null;

type MapState = "loading" | "ready" | "error" | "unsupported";

const HCMC_CENTER: [number, number] = [106.7009, 10.7769];

interface PointFeature {
  type: "Feature";
  id: number;
  properties: Record<string, string | number | boolean>;
  geometry: { type: "Point"; coordinates: [number, number] };
}

function featureCollection(features: PointFeature[]) {
  return { type: "FeatureCollection" as const, features };
}

export default function MapScreen() {
  const { profile } = useAuth();
  const location = useLocationContext();
  const cityId = location.data?.selected_city?.id ?? null;
  const cityName = location.data?.selected_city?.name ?? "your city";
  const cityLat = location.data?.selected_city?.latitude ?? null;
  const cityLng = location.data?.selected_city?.longitude ?? null;

  const [filter, setFilter] = useState<Filter>("all");
  const [selection, setSelection] = useState<Selection>(null);
  const [veggiesOpen, setVeggiesOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [styleMode, setStyleMode] = useState<"mapbox" | "fallback">("mapbox");
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );

  useEffect(() => {
    logAnalyticsEvent("map_opened", {});
  }, []);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mapRef = useRef<any>(null);
  const mapboxRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const onScreenRef = useRef<Record<string, any>>({});
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const selectionIdRef = useRef<string | null>(null);

  const dataQ = useQuery({
    queryKey: ["member-map", cityId],
    queryFn: () => fetchMemberMapData(cityId as string),
    enabled: !!cityId,
    staleTime: 60_000,
  });

  const featuredQ = useQuery({
    queryKey: ["member-map-featured", cityId],
    queryFn: () => fetchFeaturedPlaceIds(cityId),
    enabled: !!cityId,
    staleTime: 60_000,
  });

  const veggiesQ = useQuery({
    queryKey: ["member-map-veggies", cityId, profile?.id ?? null],
    queryFn: () => fetchNearbyVeggiesByCity(cityId as string, profile?.id as string, 24),
    enabled: !!cityId && !!profile?.id,
    staleTime: 60_000,
  });

  const center = useMemo<[number, number]>(
    () => (cityLng != null && cityLat != null ? [cityLng, cityLat] : HCMC_CENTER),
    [cityLat, cityLng],
  );

  const meetups = dataQ.data?.meetups ?? [];
  const places = dataQ.data?.places ?? [];

  const lookupRef = useRef<Record<string, Selection>>({});
  useEffect(() => {
    const next: Record<string, Selection> = {};
    meetups.forEach((m) => (next[`meetup:${m.id}`] = { kind: "meetup", item: m }));
    places.forEach((p) => (next[`place:${p.id}`] = { kind: "place", item: p }));
    lookupRef.current = next;
  }, [meetups, places]);

  const meetupData = useMemo(
    () =>
      featureCollection(
        meetups.map((m, i) => ({
          type: "Feature" as const,
          id: i + 1,
          properties: {
            kind: "meetup",
            key: `meetup:${m.id}`,
            glyph: meetupMarkerEmoji(m.primary_interest_id),
            label: m.title,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [m.longitude, m.latitude] as [number, number],
          },
        })),
      ),
    [meetups],
  );

  const featuredIds = featuredQ.data ?? [];
  const placeData = useMemo(
    () =>
      featureCollection(
        places.map((p, i) => ({
          type: "Feature" as const,
          id: i + 1,
          properties: {
            kind: "place",
            key: `place:${p.id}`,
            glyph: PLACE_STICKER_PLACEHOLDERS[placeStickerGroup(p.category)],
            group: placeStickerGroup(p.category),
            label: p.name,
            featured: featuredIds.includes(p.id),
          },
          geometry: {
            type: "Point" as const,
            coordinates: [p.longitude, p.latitude] as [number, number],
          },
        })),
      ),
    [places, featuredIds],
  );

  const select = useCallback((key: string) => {
    setSelection(lookupRef.current[key] ?? null);
    selectionIdRef.current = key;
  }, []);

  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl) return;
    const next: Record<string, unknown> = {};

    for (const src of ["vm-meetups", "vm-places"] as const) {
      if (!map.getSource(src) || !map.isSourceLoaded(src)) continue;
      const kind = src === "vm-meetups" ? "meetup" : "place";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const features: any[] = map.querySourceFeatures(src);
      for (const f of features) {
        const coords = f.geometry.coordinates as [number, number];
        const props = f.properties ?? {};
        const isCluster = !!props.cluster;
        const id = isCluster ? `cluster:${kind}:${props.cluster_id}` : String(props.key);
        if (next[id]) continue;
        next[id] = true;
        let marker = markersRef.current[id];
        if (!marker) {
          const el = isCluster
            ? clusterMarkerElement(kind, Number(props.point_count), () => {
                map
                  .getSource(src)
                  .getClusterExpansionZoom(props.cluster_id, (err: unknown, zoom: number) => {
                    if (err) return;
                    map.easeTo({
                      center: coords,
                      zoom,
                      duration: prefersReducedMotion() ? 0 : 400,
                    });
                  });
              })
            : pointMarkerElement(
                kind,
                String(props.glyph),
                String(props.label),
                String(props.group ?? "other"),
                props.featured === true || props.featured === "true",
                false,
                kind === "meetup" && lookupRef.current[id]?.kind === "meetup"
                  ? lookupRef.current[id].item.cover_image_url
                  : null,
                () => select(id),
              );
          marker = new mapboxgl.Marker({ element: el }).setLngLat(coords);
          markersRef.current[id] = marker;
        }
        if (!onScreenRef.current[id]) marker.addTo(map);
      }
    }

    for (const id of Object.keys(onScreenRef.current)) {
      if (!next[id]) onScreenRef.current[id].remove();
    }
    const onScreen: Record<string, unknown> = {};
    for (const id of Object.keys(next)) onScreen[id] = markersRef.current[id];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onScreenRef.current = onScreen as any;

    Object.entries(markersRef.current).forEach(([id, m]) => {
      const el = m.getElement() as HTMLElement;
      el.dataset.selected = String(id === selectionIdRef.current);
    });
  }, [select]);

  // ---- map lifecycle ----
  useEffect(() => {
    if (!webglSupported()) {
      setMapState("unsupported");
      return;
    }
    if (!MAPBOX_PUBLIC_TOKEN) {
      setMapState("error");
      return;
    }
    let cancelled = false;
    setMapState("loading");
    (async () => {
      try {
        const mod = (await import("mapbox-gl")) as unknown as { default?: unknown };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapboxgl = (mod.default ?? mod) as any;
        if (cancelled || !containerRef.current) return;
        mapboxRef.current = mapboxgl;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mapboxgl as any).accessToken = MAPBOX_PUBLIC_TOKEN;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = new (mapboxgl as any).Map({
          container: containerRef.current,
          style: styleMode === "mapbox" ? MAPBOX_STYLE : UNAUTHORIZED_FALLBACK_STYLE,
          center,
          zoom: CITY_OVERVIEW_ZOOM,
          attributionControl: true,
          // No GeolocateControl: the Map never requests GPS permission.
        });
        mapRef.current = map;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addControl(new (mapboxgl as any).NavigationControl({ showCompass: false }), "top-right");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on("error", (e: any) => {
          const status = e?.error?.status;
          const msg = String(e?.error?.message ?? "");
          if ((status === 403 || /403|Forbidden/i.test(msg)) && styleMode === "mapbox") {
            setStyleMode("fallback");
            return;
          }
          setMapState((s) => (s === "ready" ? s : "error"));
        });

        map.on("load", () => {
          if (cancelled) return;
          for (const src of ["vm-meetups", "vm-places"]) {
            map.addSource(src, {
              type: "geojson",
              data: featureCollection([]),
              ...CLUSTER_CONFIG,
            });
            map.addLayer({
              id: `${src}-hidden`,
              type: "circle",
              source: src,
              paint: { "circle-radius": 1, "circle-opacity": 0 },
            });
          }
          for (const layer of map.getStyle().layers ?? []) {
            if (layer.type === "symbol" && /poi|transit/i.test(layer.id)) {
              map.setLayoutProperty(layer.id, "visibility", "none");
            }
          }
          setMapState("ready");
          map.on("render", updateMarkers);
        });
      } catch {
        if (!cancelled) setMapState("error");
      }
    })();
    return () => {
      cancelled = true;
      Object.values(markersRef.current).forEach((m) => m.remove?.());
      markersRef.current = {};
      onScreenRef.current = {};
      mapRef.current?.remove?.();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, styleMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    map.easeTo({ center, zoom: CITY_OVERVIEW_ZOOM, duration: prefersReducedMotion() ? 0 : 300 });
  }, [center, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    map.getSource("vm-meetups")?.setData(filter === "places" ? featureCollection([]) : meetupData);
    map.getSource("vm-places")?.setData(filter === "meetups" ? featureCollection([]) : placeData);
    updateMarkers();
  }, [filter, meetupData, placeData, mapState, updateMarkers]);

  useEffect(() => {
    if (!selection) selectionIdRef.current = null;
    updateMarkers();
  }, [selection, updateMarkers]);

  const veggies = veggiesQ.data ?? [];
  const visibleMeetups = filter === "places" ? 0 : meetups.length;
  const visiblePlaces = filter === "meetups" ? 0 : places.length;
  const cityEmpty = mapState === "ready" && !dataQ.isPending && visibleMeetups === 0 && visiblePlaces === 0;

  return (
    // `flex-1` fills the app shell above the unchanged bottom navigation.
    <main className="relative flex-1 min-h-[32rem] w-full overflow-hidden bg-muted" aria-label="VeggieMeet Map">
      <h1 className="sr-only">Map</h1>
      <div className="absolute inset-0">
        <div ref={containerRef} data-testid="member-map-canvas" className="h-full w-full" />

        {mapState === "loading" && (
          <div aria-hidden data-testid="member-map-shimmer" className="image-shimmer absolute inset-0" />
        )}

        {mapState === "unsupported" && (
          <div className="absolute inset-0 grid place-items-center bg-card/95 p-6 text-center">
            <div>
              <p className="text-sm font-medium text-charcoal">This device can't display the map.</p>
              <Link
                to="/community"
                className="mt-3 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                View as list
              </Link>
            </div>
          </div>
        )}

        {(mapState === "error" || dataQ.isError) && mapState !== "unsupported" && (
          <div className="absolute inset-0 grid place-items-center bg-card/95 p-6 text-center">
            <div>
              <p className="text-sm font-medium text-charcoal">We couldn't load the map.</p>
              <div className="mt-3 flex justify-center gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    setReloadKey((k) => k + 1);
                    dataQ.refetch();
                  }}
                  className="min-h-11 rounded-full px-5"
                >
                  Try again
                </Button>
                <Button asChild variant="outline" className="min-h-11 rounded-full px-5">
                  <Link to="/community">View as list</Link>
                </Button>
              </div>
            </div>
          </div>
        )}

        {cityEmpty && (
          <div className="pointer-events-none absolute inset-x-4 bottom-20 rounded-card border border-border bg-card/95 p-4 text-center shadow-md sm:inset-x-auto sm:left-1/2 sm:w-96 sm:-translate-x-1/2">
            <p className="text-sm text-charcoal">
              Nothing on the map in {cityName} yet. Community Places and Meetups appear here as they
              are published.
            </p>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
        <Button
          type="button"
          variant="outline"
          onClick={() => setVeggiesOpen(true)}
          className="pointer-events-auto min-h-11 max-w-[calc(100vw-1.5rem)] rounded-full border-primary/30 bg-card/95 px-4 text-charcoal shadow-md"
        >
          <Users className="text-primary" aria-hidden />
          <span className="truncate">{nearbyVeggieCountLabel(veggies.length)}</span>
          <span aria-hidden>›</span>
        </Button>

        <div
          className="pointer-events-auto mt-2 flex max-w-full gap-1.5 overflow-x-auto no-scrollbar"
          role="group"
          aria-label="Map layers"
        >
          {(["all", "meetups", "places"] as Filter[]).map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`min-h-10 shrink-0 rounded-full px-3.5 shadow-sm ${filter === f ? "" : "bg-card/95"}`}
            >
              {f === "all" ? "All" : f === "meetups" ? "Meetups" : "Community Places"}
            </Button>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-[max(1.75rem,env(safe-area-inset-bottom))] z-10 flex items-end justify-between gap-2 sm:inset-x-5">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="pointer-events-auto rounded-full border-border bg-card/95 shadow-md"
        >
          <Link to="/community">
            <List aria-hidden /> View as list
          </Link>
        </Button>
        {offline && (
          <p className="pointer-events-auto max-w-64 rounded-card border border-warning-border bg-warning-soft p-3 text-xs text-warning-foreground shadow-md">
            <WifiOff className="mr-1 inline h-4 w-4" aria-hidden /> You're offline. The Community list
            may still contain recently loaded content.
          </p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {dataQ.data
          ? `${visibleMeetups} Meetups and ${visiblePlaces} Community Places on the map.`
          : "Loading map data…"}
      </p>
      {styleMode === "fallback" && <p className="sr-only">The fallback basemap is active.</p>}

      {/* ---- Meetup / Place bottom sheet ---- */}
      <Sheet open={!!selection} onOpenChange={(o) => !o && setSelection(null)}>
        <SheetContent
          side="bottom"
          overlayClassName="bg-foreground/20"
          className="left-1/2 max-h-[58vh] w-full max-w-xl -translate-x-1/2 overflow-y-auto rounded-t-dialog pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg"
        >
          {selection?.kind === "meetup" && (
            <MeetupMapSheetContent
              title={selection.item.title}
              dateLabel={formatMeetupDate(selection.item.date)}
              timeLabel={formatTime12h(selection.item.start_time)}
              locationLabel={selection.item.location_name ?? "Location to be confirmed"}
              glyph={meetupMarkerEmoji(selection.item.primary_interest_id)}
              coverImageUrl={selection.item.cover_image_url}
              action={
                <Link
                  to={`/meetup/${selection.item.id}?from=map`}
                  className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                >
                  View Meetup
                </Link>
              }
            />
          )}
          {selection?.kind === "place" && (
            <>
              <SheetHeader>
                <SheetTitle className="text-left">{selection.item.name}</SheetTitle>
              </SheetHeader>
              <p className="mt-1 text-sm capitalize text-charcoal-muted">
                {placeStickerGroup(selection.item.category)} ·{" "}
                {selection.item.veggie_classification === "fully_vegan"
                  ? "100% vegan"
                  : selection.item.veggie_classification ?? "—"}
              </p>
              <p className="mt-1 text-sm text-charcoal-muted">{selection.item.address ?? "—"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/place/${selection.item.id}?from=map`}
                  className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                >
                  View Place
                </Link>
                <a
                  href={directionsHref(
                    selection.item.name,
                    selection.item.latitude,
                    selection.item.longitude,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-charcoal"
                >
                  Get directions
                </a>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ---- Veggies sheet: city-level only, no location of any kind ---- */}
      <Sheet open={veggiesOpen} onOpenChange={setVeggiesOpen}>
        <SheetContent
          side="bottom"
          overlayClassName="bg-foreground/20"
          className="left-1/2 max-h-[68vh] w-full max-w-xl -translate-x-1/2 overflow-y-auto rounded-t-dialog pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg"
        >
          <SheetHeader>
            <SheetTitle className="text-left">{veggieCountLabel(veggies.length, cityName)}</SheetTitle>
          </SheetHeader>
          {veggies.length === 0 ? (
            <p className="mt-2 text-sm text-charcoal-muted">{veggieEmptyCopy(cityName)}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {veggies.map((v: NearbyVeggie) => (
                <li key={v.id} className="flex items-center gap-3 py-3">
                  <UserAvatar name={v.displayName} src={v.avatarUrl ?? undefined} seed={v.id} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-charcoal">{v.displayName}</p>
                    <p className="truncate text-xs text-charcoal-muted">
                      {v.cityName ?? cityName}
                      {v.interests.length > 0 ? ` · ${v.interests.slice(0, 3).join(", ")}` : ""}
                    </p>
                  </div>
                  <Link
                    to={`/veggie/${v.id}?from=map`}
                    className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium text-charcoal"
                  >
                    View profile
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}

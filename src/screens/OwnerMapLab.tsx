import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { List, SlidersHorizontal, Users, WifiOff } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";
import { fetchFeaturedPlaceIds, fetchMapLabData, type MapLabMeetup, type MapLabPlace } from "@/lib/mapLab";
import { fetchNearbyVeggiesByCity, type NearbyVeggie } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext } from "@/hooks/useLocation";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import { UserAvatar } from "@/components/app/UserAvatar";
import { MeetupMapSheetContent } from "@/components/map/MeetupMapSheetContent";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clusterMarkerElement, pointMarkerElement } from "@/lib/mapMarkerElements";
import brunchMeetupCover from "@/assets/wo155-vegan-brunch.jpg";
import hikingMeetupCover from "@/assets/wo155-hiking-meetup.jpg";
import {
  meetupMarkerEmoji,
  placeStickerGroup,
  PLACE_STICKER_PLACEHOLDERS,
} from "@/lib/mapMarkers";
import {
  CITY_OVERVIEW_ZOOM,
  CLUSTER_CONFIG,
  FIXTURE_DENSITY_LABELS,
  MAPBOX_PUBLIC_TOKEN,
  MAPBOX_STYLE,
  UNAUTHORIZED_FALLBACK_STYLE,
  directionsHref,
  fixtureMeetups,
  fixturePlaces,
  nearbyVeggieCountLabel,
  prefersReducedMotion,
  veggieCountLabel,
  veggieEmptyCopy,
  webglSupported,
  type FixtureDensity,
} from "@/lib/mapPrototype";


/**
 * WO-153 — PRIVATE, NON-NAVIGABLE VeggieMeet Ecosystem Map prototype.
 *
 * Owner-only (`RequireOwner` + server-side `is_owner()` inside the RPC), not
 * linked from navigation, excluded from crawlers via `robots.txt` (`/owner/`),
 * and strictly read-only. Today and the bottom navigation are untouched, and
 * Community remains the independent list experience.
 *
 * Privacy invariants (WO-152 Option A):
 *  - Veggies appear ONLY in the city-level pill and sheet — never as markers.
 *  - No member coordinates, distance, GPS permission or presence data is read.
 *  - Counts below 3 are never revealed numerically.
 */

type Filter = "all" | "meetups" | "places";

type Selection =
  | { kind: "meetup"; item: MapLabMeetup }
  | { kind: "place"; item: MapLabPlace }
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

export default function OwnerMapLab() {
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const location = useLocationContext();
  const cityId = location.data?.selected_city?.id ?? null;
  const cityName = location.data?.selected_city?.name ?? "your city";

  const [filter, setFilter] = useState<Filter>("all");
  const [density, setDensity] = useState<FixtureDensity>("off");
  const [selection, setSelection] = useState<Selection>(null);
  const [veggiesOpen, setVeggiesOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * "mapbox" is the shipping basemap. "fallback" is entered only when the public
   * token is not authorised for the current URL, so the prototype stays
   * reviewable in preview without weakening the production URL restriction.
   */
  const [styleMode, setStyleMode] = useState<"mapbox" | "fallback">("mapbox");
  const showPrototypeTools = import.meta.env.DEV && searchParams.get("prototypeTools") === "1";

  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mapRef = useRef<any>(null);
  const mapboxRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const onScreenRef = useRef<Record<string, any>>({});
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const selectionIdRef = useRef<string | null>(null);

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

  const dataQ = useQuery({
    queryKey: ["owner-map-lab", cityId],
    queryFn: () => fetchMapLabData(cityId),
    enabled: !location.isPending,
    staleTime: 60_000,
  });

  const featuredQ = useQuery({
    queryKey: ["owner-map-lab-featured", cityId],
    queryFn: () => fetchFeaturedPlaceIds(cityId),
    enabled: !!cityId,
    staleTime: 60_000,
  });

  const veggiesQ = useQuery({
    queryKey: ["owner-map-lab-veggies", cityId, profile?.id ?? null],
    queryFn: () => fetchNearbyVeggiesByCity(cityId as string, profile?.id as string, 24),
    enabled: !!cityId && !!profile?.id,
    staleTime: 60_000,
  });

  const center = useMemo<[number, number]>(() => {
    const c = dataQ.data?.city;
    if (c?.longitude != null && c?.latitude != null) return [c.longitude, c.latitude];
    return HCMC_CENTER;
  }, [dataQ.data?.city]);

  // Real, already-eligible data plus (optional) clearly-labelled prototype fixtures.
  const meetups = useMemo<MapLabMeetup[]>(
    () => [
      ...(dataQ.data?.meetups ?? []),
      ...fixtureMeetups(center, density).map((meetup, index) => ({
        ...meetup,
        // WO-155 review fixtures deliberately exercise image, emoji, and 🌱 states.
        primary_interest_id: index === 2 ? null : meetup.primary_interest_id,
        cover_image_url:
          index !== 2 && index % 2 === 0
            ? index % 4 === 0
              ? brunchMeetupCover
              : hikingMeetupCover
            : null,
      })),
    ],
    [dataQ.data?.meetups, center, density],
  );
  const places = useMemo<MapLabPlace[]>(
    () => [...(dataQ.data?.places ?? []), ...fixturePlaces(center, density)],
    [dataQ.data?.places, center, density],
  );

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
            fixture: !!m.is_fixture,
          },
          geometry: { type: "Point" as const, coordinates: [m.longitude, m.latitude] as [number, number] },
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
            fixture: !!p.is_fixture,
          },
          geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] as [number, number] },
        })),
      ),
    [places, featuredIds],
  );

  const select = useCallback((key: string) => {
    const next = lookupRef.current[key] ?? null;
    setSelection(next);
    selectionIdRef.current = key;
  }, []);

  // ---- marker rendering (HTML markers over a clustered GeoJSON source) ----
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
                props.fixture === true || props.fixture === "true",
                kind === "meetup" && lookupRef.current[id]?.kind === "meetup"
                  ? lookupRef.current[id].item.cover_image_url ?? null
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

    // Selected marker emphasis.
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
          // No user-location control: the prototype never requests GPS.
        });
        mapRef.current = map;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addControl(new (mapboxgl as any).NavigationControl({ showCompass: false }), "top-right");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on("error", (e: any) => {
          const status = e?.error?.status;
          const msg = String(e?.error?.message ?? "");
          if ((status === 403 || /403|Forbidden/i.test(msg)) && styleMode === "mapbox") {
            // Token is not authorised for this URL (dev/preview domain).
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
            // Transparent layers keep source tiles loaded so HTML markers can be
            // derived from the native clustering index.
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
    // Recreated on explicit retry or when a restricted preview origin switches
    // from Mapbox tiles to the token-free fallback basemap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, styleMode]);

  // Camera follows Selected City. No fly-to; instant when reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    map.easeTo({ center, zoom: CITY_OVERVIEW_ZOOM, duration: prefersReducedMotion() ? 0 : 300 });
  }, [center, mapState]);

  // Layer data + filters. Filtering only swaps source data — never refetches.
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
  const cityEmpty = mapState === "ready" && visibleMeetups === 0 && visiblePlaces === 0;

  return (
    <main className="relative h-dvh min-h-[32rem] w-full overflow-hidden bg-muted" aria-label="Ecosystem Map private prototype">
      <h1 className="sr-only">Ecosystem Map</h1>
      <div className="absolute inset-0">
        <div ref={containerRef} data-testid="map-lab-canvas" className="h-full w-full" />

        {mapState === "loading" && (
          <div aria-hidden data-testid="map-lab-shimmer" className="image-shimmer absolute inset-0" />
        )}

        {mapState === "unsupported" && (
          <div className="absolute inset-0 grid place-items-center bg-card/95 p-6 text-center">
            <div>
              <p className="text-sm font-medium text-charcoal">This device can't display the map.</p>
              <Link to="/community" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
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
                <Button type="button" onClick={() => { setReloadKey((k) => k + 1); dataQ.refetch(); }} className="min-h-11 rounded-full px-5">
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
              Nothing on the map in {cityName} yet. Community Places and Meetups appear here as they are published.
            </p>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
        {showPrototypeTools && (
          <div className="pointer-events-auto absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] sm:right-5">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 rounded-full border-border bg-card/95 shadow-md" aria-label="Prototype tools"><SlidersHorizontal aria-hidden /></Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))] rounded-card p-4">
                <p className="text-sm font-semibold text-charcoal">Prototype tools</p>
                <p className="mt-1 text-xs text-charcoal-muted">Fixture data is temporary and never saved.</p>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Prototype data density">
                  {(Object.keys(FIXTURE_DENSITY_LABELS) as FixtureDensity[]).map((d) => (
                    <Button key={d} type="button" size="sm" variant={density === d ? "default" : "outline"} onClick={() => setDensity(d)} aria-pressed={density === d} className="rounded-full">
                      {FIXTURE_DENSITY_LABELS[d]}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        <Button type="button" variant="outline" onClick={() => setVeggiesOpen(true)} className="pointer-events-auto min-h-11 max-w-[calc(100vw-1.5rem)] rounded-full border-primary/30 bg-card/95 px-4 text-charcoal shadow-md">
          <Users className="text-primary" aria-hidden />
          <span className="truncate">{nearbyVeggieCountLabel(veggies.length)}</span>
          <span aria-hidden>›</span>
        </Button>

        <div className="pointer-events-auto mt-2 flex max-w-full gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Map layers">
          {(["all", "meetups", "places"] as Filter[]).map((f) => (
            <Button key={f} type="button" size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`min-h-10 shrink-0 rounded-full px-3.5 shadow-sm ${filter === f ? "" : "bg-card/95"}`}>
              {f === "all" ? "All" : f === "meetups" ? "Meetups" : "Community Places"}
            </Button>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-[max(1.75rem,env(safe-area-inset-bottom))] z-10 flex items-end justify-between gap-2 sm:inset-x-5">
        <Button asChild variant="outline" size="sm" className="pointer-events-auto rounded-full border-border bg-card/95 shadow-md">
          <Link to="/community"><List aria-hidden /> View as list</Link>
        </Button>
        {offline && (
          <p className="pointer-events-auto max-w-64 rounded-card border border-warning-border bg-warning-soft p-3 text-xs text-warning-foreground shadow-md">
            <WifiOff className="mr-1 inline h-4 w-4" aria-hidden /> You're offline. The Community list may still contain recently loaded content.
          </p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {dataQ.data ? `${visibleMeetups} Meetups and ${visiblePlaces} Community Places on the map${density === "off" ? "" : " including prototype data"}.` : "Loading map data…"}
      </p>
      {styleMode === "fallback" && <p className="sr-only">The fallback basemap is active.</p>}

      {/* ---- Meetup / Place bottom sheet ---- */}
      <Sheet open={!!selection} onOpenChange={(o) => !o && setSelection(null)}>
        <SheetContent side="bottom" overlayClassName="bg-foreground/20" className="left-1/2 max-h-[58vh] w-full max-w-xl -translate-x-1/2 overflow-y-auto rounded-t-dialog pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg">
          {selection?.kind === "meetup" && (
            <MeetupMapSheetContent
              title={selection.item.title}
              dateLabel={formatMeetupDate(selection.item.date)}
              timeLabel={formatTime12h(selection.item.start_time)}
              locationLabel={selection.item.location_name ?? "Location to be confirmed"}
              glyph={meetupMarkerEmoji(selection.item.primary_interest_id)}
              coverImageUrl={selection.item.cover_image_url ?? null}
              prototype={selection.item.is_fixture}
              action={
                !selection.item.is_fixture ? (
                  <Link
                    to={`/meetup/${selection.item.id}?from=map-lab`}
                    className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                  >
                    View Meetup
                  </Link>
                ) : null
              }
            />
          )}
          {selection?.kind === "place" && (
            <>
              <SheetHeader>
                <SheetTitle className="text-left">
                  {selection.item.name}
                  {selection.item.is_fixture && (
                    <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                      Prototype data
                    </span>
                  )}
                </SheetTitle>
              </SheetHeader>
              <p className="mt-1 text-sm text-charcoal-muted capitalize">
                {placeStickerGroup(selection.item.category)} ·{" "}
                {selection.item.veggie_classification === "fully_vegan"
                  ? "100% vegan"
                  : selection.item.veggie_classification ?? "—"}
              </p>
              <p className="mt-1 text-sm text-charcoal-muted">{selection.item.address ?? "—"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {!selection.item.is_fixture && (
                  <Link
                    to={`/place/${selection.item.id}?from=map-lab`}
                    className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                  >
                    View Place
                  </Link>
                )}
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
        <SheetContent side="bottom" overlayClassName="bg-foreground/20" className="left-1/2 max-h-[68vh] w-full max-w-xl -translate-x-1/2 overflow-y-auto rounded-t-dialog pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg">
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
                    to={`/veggie/${v.id}?from=map-lab`}
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

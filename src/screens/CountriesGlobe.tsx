import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Check, Search, X } from "lucide-react";
import { toast } from "sonner";
import "mapbox-gl/dist/mapbox-gl.css";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useAuth } from "@/hooks/useAuth";
import { useProfileCountries, useSaveMyCountries } from "@/hooks/useProfileCountries";
import { CountriesPill } from "@/components/profile/CountriesPill";
import { COUNTRIES, countryByCode, flagEmoji, isCountryCode, searchCountries, type Country } from "@/lib/countries";
import { MAPBOX_PUBLIC_TOKEN, normalizeFallbackGlyphUrl, webglSupported } from "@/lib/mapPrototype";
import { reducedMotion } from "@/lib/celebrations";
import { safeBack } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Full-screen globe of the countries a member has set foot in, the way
 * NomadTable does it: a draggable 3D globe (Mapbox GL globe projection, dark
 * style with stars), the visited countries lit up, tap a country to toggle
 * it, or search by name. Polygons come from the bundled Natural Earth 110 m
 * file (public/data/countries-110m.json); micro-states without a polygon are
 * drawn as dots. Falls back to MapLibre + CARTO dark when the Mapbox token is
 * missing or unauthorised, and to a plain list when WebGL is unavailable.
 *
 * Routes: /you/countries (edit own) and /veggie/:id/countries (view only).
 */

const GLOBE_FILL = "#3fa86a";
const GLOBE_GLOW = "#64c48c";
const SPACE = "#05070f";
const DATA_URL = `${import.meta.env.BASE_URL}data/countries-110m.json`;
const MAPBOX_DARK_STYLE = "mapbox://styles/mapbox/dark-v11";
const FALLBACK_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const SELECTED_LAYERS = ["vm-country-fill", "vm-country-glow"] as const;

function selectedFilter(codes: string[]) {
  return ["in", ["get", "c"], ["literal", codes]];
}

function dotsCollection(codes: string[]) {
  return {
    type: "FeatureCollection",
    features: codes
      .map(countryByCode)
      .filter((c): c is Country => !!c && c.dot === true)
      .map((c) => ({
        type: "Feature",
        properties: { c: c.code, n: c.name },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
  };
}

export default function CountriesGlobe() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const { profile } = useAuth();
  const editable = !id;
  const profileId = editable ? profile?.id ?? null : id ?? null;
  const ownerName: string | undefined = (location.state as { name?: string } | null)?.name;

  const query = useProfileCountries(profileId, editable);
  const save = useSaveMyCountries(profileId);

  // Working selection, seeded once from the server list.
  const [selected, setSelected] = useState<string[] | null>(null);
  useEffect(() => {
    if (selected === null && query.data) setSelected(query.data.codes);
  }, [query.data, selected]);
  const codes = useMemo(() => selected ?? query.data?.codes ?? [], [selected, query.data]);
  const codesRef = useRef(codes);
  codesRef.current = codes;
  const dirty = !!query.data && !!selected && (selected.length !== query.data.codes.length || selected.some((c) => !query.data!.codes.includes(c)));

  const toggle = (code: string) => {
    if (!editable || !isCountryCode(code)) return;
    setSelected((prev) => {
      const cur = prev ?? codesRef.current;
      return cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    });
  };

  // ---- map ----
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [engine, setEngine] = useState<"mapbox" | "fallback">(() => (MAPBOX_PUBLIC_TOKEN ? "mapbox" : "fallback"));
  const [mapState, setMapState] = useState<"loading" | "ready" | "unsupported" | "error">(() => (webglSupported() ? "loading" : "unsupported"));
  const interactedRef = useRef(false);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    if (mapState === "unsupported") return;
    let cancelled = false;
    let spinTimer: number | null = null;
    setMapState("loading");
    (async () => {
      try {
        const mod = (engine === "mapbox" ? await import("mapbox-gl") : await import("maplibre-gl")) as unknown as { default?: unknown };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gl = (mod.default ?? mod) as any;
        if (cancelled || !containerRef.current) return;
        if (engine === "mapbox") gl.accessToken = MAPBOX_PUBLIC_TOKEN;
        else gl.setWorkerUrl(maplibreWorkerUrl);

        const first = codesRef.current[0] ? countryByCode(codesRef.current[0]) : null;
        const center: [number, number] = first ? [first.lng, first.lat] : [106, 16];
        const map = new gl.Map({
          container: containerRef.current,
          style: engine === "mapbox" ? MAPBOX_DARK_STYLE : FALLBACK_DARK_STYLE,
          projection: engine === "mapbox" ? "globe" : undefined,
          center,
          zoom: 1.6,
          minZoom: 0.8,
          maxZoom: 6,
          attributionControl: true,
          transformRequest: engine === "fallback" ? (url: string) => ({ url: normalizeFallbackGlyphUrl(url) }) : undefined,
        });
        mapRef.current = map;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on("error", (e: any) => {
          const status = e?.error?.status;
          const msg = String(e?.error?.message ?? "");
          if ((status === 401 || status === 403 || /401|403|Unauthorized|Forbidden|access token/i.test(msg)) && engine === "mapbox") {
            setEngine("fallback");
            return;
          }
          const resourceId = e?.sourceId ?? e?.source?.id ?? e?.tile?.tileID;
          if (resourceId || /tile|sprite|glyph|image/i.test(msg)) return;
          setMapState((s) => (s === "ready" ? s : "error"));
        });

        map.on("style.load", () => {
          if (cancelled) return;
          if (engine === "mapbox") {
            try {
              map.setFog({
                color: "rgb(14, 20, 38)",
                "high-color": "rgb(24, 40, 70)",
                "horizon-blend": 0.05,
                "space-color": SPACE,
                "star-intensity": 0.7,
              });
            } catch {
              /* older style without fog support */
            }
          } else {
            try {
              map.setProjection({ type: "globe" });
            } catch {
              /* flat map is still usable */
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const firstSymbol = (map.getStyle()?.layers ?? []).find((l: any) => l.type === "symbol")?.id;
          map.addSource("vm-countries", { type: "geojson", data: DATA_URL });
          map.addSource("vm-dots", { type: "geojson", data: dotsCollection(codesRef.current) });
          map.addLayer(
            { id: "vm-country-hit", type: "fill", source: "vm-countries", paint: { "fill-color": "#000000", "fill-opacity": 0 } },
            firstSymbol,
          );
          map.addLayer(
            {
              id: "vm-country-fill",
              type: "fill",
              source: "vm-countries",
              filter: selectedFilter(codesRef.current),
              paint: { "fill-color": GLOBE_FILL, "fill-opacity": 0.55 },
            },
            firstSymbol,
          );
          map.addLayer(
            {
              id: "vm-country-glow",
              type: "line",
              source: "vm-countries",
              filter: selectedFilter(codesRef.current),
              paint: { "line-color": GLOBE_GLOW, "line-width": 2.5, "line-blur": 3, "line-opacity": 0.95 },
            },
            firstSymbol,
          );
          map.addLayer({
            id: "vm-dots",
            type: "circle",
            source: "vm-dots",
            paint: {
              "circle-radius": 5,
              "circle-color": GLOBE_FILL,
              "circle-stroke-color": GLOBE_GLOW,
              "circle-stroke-width": 2,
              "circle-blur": 0.2,
            },
          });
          map.on("click", "vm-country-hit", (e: { features?: Array<{ properties?: { c?: string } }> }) => {
            const code = e.features?.[0]?.properties?.c;
            if (code && editableRef.current) toggleRef.current(code);
          });
          map.on("mouseenter", "vm-country-hit", () => {
            if (editableRef.current) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "vm-country-hit", () => {
            map.getCanvas().style.cursor = "";
          });
          setMapState("ready");

          // Gentle auto-spin until the member touches the globe.
          const stop = () => {
            interactedRef.current = true;
          };
          for (const ev of ["mousedown", "touchstart", "wheel", "dragstart"]) map.on(ev, stop);
          if (!reducedMotion()) {
            const spin = () => {
              if (cancelled || interactedRef.current || map.getZoom() > 3) return;
              const c = map.getCenter();
              map.easeTo({ center: [c.lng + 6, c.lat], duration: 2500, easing: (n: number) => n });
            };
            map.on("moveend", () => {
              if (!interactedRef.current) spinTimer = window.setTimeout(spin, 50);
            });
            spin();
          }
        });
      } catch {
        if (!cancelled) setMapState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (spinTimer != null) window.clearTimeout(spinTimer);
      try {
        mapRef.current?.remove();
      } catch {
        /* already gone */
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when the engine changes
  }, [engine]);

  // Push the current selection into the map layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    try {
      for (const layer of SELECTED_LAYERS) map.setFilter(layer, selectedFilter(codes));
      map.getSource("vm-dots")?.setData(dotsCollection(codes));
    } catch {
      /* style not ready yet */
    }
  }, [codes, mapState]);

  const flyTo = (c: Country) => {
    interactedRef.current = true;
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    try {
      map.flyTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), c.dot ? 4 : 2.6), duration: reducedMotion() ? 0 : 1200 });
    } catch {
      /* ignore */
    }
  };

  // ---- search ----
  const [q, setQ] = useState("");
  const results = useMemo(() => searchCountries(q, 8), [q]);
  const pick = (c: Country) => {
    toggle(c.code);
    flyTo(c);
    setQ("");
  };

  const close = () => safeBack(navigate, editable ? "/you" : `/veggie/${id}`);
  const done = () => {
    if (!dirty) {
      close();
      return;
    }
    save.mutate(codes, {
      onSuccess: () => {
        toast.success("Countries saved");
        close();
      },
      onError: (e) => toast.error("Couldn't save your countries", { description: e instanceof Error ? e.message : undefined }),
    });
  };

  const unavailable = query.data && !query.data.available;
  const hint = editable
    ? "Spin the globe and tap every country you've set foot in."
    : `Countries ${ownerName ?? "this Veggie"} has set foot in.`;

  return (
    <div className="fixed inset-0 z-50 text-white" style={{ background: SPACE }} data-testid="countries-globe">
      {/* Globe */}
      {mapState !== "unsupported" && <div ref={containerRef} className="absolute inset-0" aria-hidden={mapState !== "ready"} />}
      {mapState === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">Loading the globe…</div>
      )}
      {(mapState === "unsupported" || mapState === "error") && (
        <div className="absolute inset-x-0 top-24 bottom-40 overflow-y-auto px-5">
          <p className="text-sm text-white/70 mb-3">
            {mapState === "error" ? "The globe couldn't load here, but your list still works." : "This device can't draw the globe, but your list still works."}
          </p>
          <ul className="space-y-1.5">
            {codes.map((code) => {
              const c = countryByCode(code);
              if (!c) return null;
              return (
                <li key={code} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm">
                  <span aria-hidden>{flagEmoji(code)}</span>
                  <span className="flex-1">{c.name}</span>
                  {editable && (
                    <button type="button" onClick={() => toggle(code)} className="text-white/60 hover:text-white" aria-label={`Remove ${c.name}`}>
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Top bar */}
      <div
        className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="w-11 h-11 rounded-full bg-black/50 backdrop-blur border border-white/15 flex items-center justify-center active:scale-95 transition-transform"
        >
          <X className="w-5 h-5" />
        </button>
        <CountriesPill count={codes.length} variant="dark" />
        {editable ? (
          <button
            type="button"
            onClick={done}
            disabled={save.isPending || !query.data}
            className="h-11 px-5 rounded-full bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-60 active:scale-95 transition-transform"
          >
            {save.isPending ? "Saving…" : "Done"}
          </button>
        ) : (
          <span className="w-11" aria-hidden />
        )}
      </div>

      {/* Bottom: hint + search */}
      <div
        className="absolute inset-x-0 bottom-0 px-4 space-y-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        {unavailable ? (
          <p className="text-center text-sm text-white/70">This list isn't available.</p>
        ) : (
          <p className="text-center text-sm text-white/80 drop-shadow">{hint}</p>
        )}
        {editable && (
          <div className="relative">
            {results.length > 0 && (
              <ul
                role="listbox"
                aria-label="Matching countries"
                className="absolute bottom-full mb-2 inset-x-0 rounded-2xl bg-[#0d1220]/95 backdrop-blur border border-white/15 overflow-hidden max-h-72 overflow-y-auto"
              >
                {results.map((c) => {
                  const on = codes.includes(c.code);
                  return (
                    <li key={c.code}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => pick(c)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-white/10 active:bg-white/15"
                      >
                        <span className="text-lg" aria-hidden>{flagEmoji(c.code)}</span>
                        <span className="flex-1">{c.name}</span>
                        {on && <Check className="w-4 h-4 text-primary" aria-label="Visited" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <label className="flex items-center gap-3 h-14 rounded-full bg-[#0d1220]/90 backdrop-blur border border-white/15 px-5">
              <Search className="w-5 h-5 text-white/60 shrink-0" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results[0]) pick(results[0]);
                  if (e.key === "Escape") setQ("");
                }}
                placeholder="Type a country name…"
                aria-label="Search countries"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className={cn("flex-1 bg-transparent text-base text-white placeholder:text-white/50 focus:outline-none")}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

// Referenced so the dataset stays tree-shake-safe when only the list view is used.
void COUNTRIES;

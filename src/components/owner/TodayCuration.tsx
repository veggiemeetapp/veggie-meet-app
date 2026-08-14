import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { logAnalyticsEvent } from "@/lib/analytics";
import { useActiveCities } from "@/hooks/useLocation";
import {
  fetchTodayCuration,
  isTodayEligible,
  moveFeatured,
  operationalLabel,
  reorderTodayFeatured,
  setTodayPlaceState,
  splitCuration,
  type CurationPlace,
  type TodayPlaceState,
} from "@/lib/todayCuration";

/**
 * WO-106 — owner-only Today curation.
 *
 * Featured places are prioritized on Today; every remaining slot is filled by
 * the existing automatic recommendation ranking. Hiding a place affects Today
 * only — it stays available in Community Places, Search, Host and Check In.
 */

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

function Row({
  place,
  position,
  children,
}: {
  place: CurationPlace;
  position?: number;
  children: React.ReactNode;
}) {
  const eligible = isTodayEligible(place);
  return (
    <li className="rounded-control border bg-card p-3">
      <div className="flex flex-wrap items-start gap-3">
        {position !== undefined && (
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary"
          >
            {position}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-charcoal">
            {position !== undefined && <span className="sr-only">Position {position}. </span>}
            {place.name}
          </p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {CATEGORY_LABEL[place.category] ?? place.category} · {operationalLabel(place)}
            {!eligible && " · Not shown on Today"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </li>
  );
}

export default function TodayCuration() {
  const qc = useQueryClient();
  const citiesQ = useActiveCities();
  const [cityId, setCityId] = useState<string | null>(null);

  useEffect(() => {
    logAnalyticsEvent("today_place_curation_opened", {});
  }, []);

  // Single-city beta: preselect, but the model is never hardcoded to one city.
  useEffect(() => {
    const cities = citiesQ.data ?? [];
    if (!cityId && cities.length > 0) setCityId(cities[0].id);
  }, [citiesQ.data, cityId]);

  const curationQ = useQuery({
    queryKey: ["today-curation", cityId],
    queryFn: () => fetchTodayCuration(cityId as string),
    enabled: !!cityId,
  });

  const slotLimit = curationQ.data?.slot_limit ?? 3;
  const { featured, normal, hidden } = useMemo(
    () => splitCuration(curationQ.data?.places ?? []),
    [curationQ.data],
  );

  const [status, setStatus] = useState("");

  function afterChange(message: string) {
    setStatus(message);
    toast({ description: message });
    qc.invalidateQueries({ queryKey: ["today-curation", cityId] });
    // Owner's own Today refreshes immediately; member clients pick the change
    // up through the existing Today refetch behaviour.
    qc.invalidateQueries({ queryKey: ["today-experience"] });
  }

  function onError(e: unknown) {
    const message = e instanceof Error ? e.message : "Couldn’t save that change.";
    setStatus(message);
    toast({ description: message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["today-curation", cityId] });
  }

  const stateM = useMutation({
    mutationFn: (v: { place: CurationPlace; state: TodayPlaceState }) =>
      setTodayPlaceState(v.place.place_id, v.state),
    onSuccess: (_d, v) => {
      if (v.state === "featured") {
        logAnalyticsEvent("today_place_featured", {
          city_id: cityId,
          featured_slot: Math.min(featured.length + 1, slotLimit),
        });
        afterChange(`${v.place.name} is now featured on Today.`);
      } else if (v.state === "hidden") {
        logAnalyticsEvent("today_place_hidden", { city_id: cityId });
        afterChange(`${v.place.name} is hidden from Today.`);
      } else {
        logAnalyticsEvent(
          v.place.state === "hidden" ? "today_place_restored" : "today_place_unfeatured",
          { city_id: cityId },
        );
        afterChange(`${v.place.name} is back in automatic recommendations.`);
      }
    },
    onError,
  });

  const reorderM = useMutation({
    mutationFn: (ids: string[]) => reorderTodayFeatured(cityId as string, ids),
    onSuccess: () => {
      logAnalyticsEvent("today_place_reordered", { city_id: cityId });
      afterChange("Featured order updated.");
    },
    onError,
  });

  const busy = stateM.isPending || reorderM.isPending;

  function move(index: number, direction: "up" | "down") {
    const ids = featured.map((p) => p.place_id);
    const next = moveFeatured(ids, index, direction);
    if (next === ids) return;
    reorderM.mutate(next);
  }

  const cities = citiesQ.data ?? [];
  const featuredVisible = featured.filter(isTodayEligible).slice(0, slotLimit);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-charcoal">Today Community Place curation</h2>
        <p className="text-sm text-muted-foreground">
          Choose which verified places are prioritized on Today. Featured places appear first;
          remaining slots use automatic recommendations.
        </p>
        <p className="text-xs text-muted-foreground">
          Today displays up to {slotLimit} Community Places.
        </p>
      </header>

      {cities.length > 1 && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="curation-city">City</Label>
          <Select value={cityId ?? undefined} onValueChange={setCityId}>
            <SelectTrigger id="curation-city">
              <SelectValue placeholder="Select a city" />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {cities.length === 1 && (
        <p className="text-xs text-muted-foreground">City: {cities[0].name}</p>
      )}

      <p aria-live="polite" role="status" className="sr-only">
        {status}
      </p>

      {curationQ.isPending || citiesQ.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : curationQ.error ? (
        <div className="rounded-control border bg-card p-4">
          <p className="text-sm text-charcoal">Couldn’t load Today curation.</p>
          <Button className="mt-3" variant="outline" onClick={() => curationQ.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Today preview — names only, no duplicate Today UI. */}
          <section aria-labelledby="today-preview-h" className="rounded-control border bg-card p-3">
            <h3 id="today-preview-h" className="text-sm font-semibold text-charcoal">
              Today preview
            </h3>
            <ol className="mt-2 space-y-1 text-sm text-muted-foreground">
              {Array.from({ length: slotLimit }).map((_, i) => (
                <li key={i} className="break-words">
                  <span className="tabular-nums">{i + 1}.</span>{" "}
                  {featuredVisible[i] ? featuredVisible[i].name : "Automatic recommendation"}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="featured-h" className="space-y-2">
            <h3 id="featured-h" className="text-sm font-semibold text-charcoal">
              Featured on Today
            </h3>
            {featured.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing featured yet. Today uses automatic recommendations only.
              </p>
            ) : (
              <ol className="space-y-2">
                {featured.map((p, i) => (
                  <Row key={p.place_id} place={p} position={i + 1}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || i === 0}
                      aria-label={`Move ${p.name} up`}
                      onClick={() => move(i, "up")}
                    >
                      <ArrowUp className="mr-1 h-4 w-4" aria-hidden /> Move up
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || i === featured.length - 1}
                      aria-label={`Move ${p.name} down`}
                      onClick={() => move(i, "down")}
                    >
                      <ArrowDown className="mr-1 h-4 w-4" aria-hidden /> Move down
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`Remove ${p.name} from featured`}
                      onClick={() => stateM.mutate({ place: p, state: "normal" })}
                    >
                      Remove from featured
                    </Button>
                  </Row>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="automatic-h" className="space-y-2">
            <h3 id="automatic-h" className="text-sm font-semibold text-charcoal">
              Automatic recommendations
            </h3>
            <p className="text-xs text-muted-foreground">
              These places stay eligible for the normal Today ranking.
            </p>
            {normal.length === 0 ? (
              <p className="text-sm text-muted-foreground">No places in automatic right now.</p>
            ) : (
              <ul className="space-y-2">
                {normal.map((p) => (
                  <Row key={p.place_id} place={p}>
                    <Button
                      size="sm"
                      disabled={busy}
                      aria-label={`Feature ${p.name} on Today`}
                      onClick={() => stateM.mutate({ place: p, state: "featured" })}
                    >
                      Feature on Today
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`Hide ${p.name} from Today`}
                      onClick={() => stateM.mutate({ place: p, state: "hidden" })}
                    >
                      Hide from Today
                    </Button>
                  </Row>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="hidden-h" className="space-y-2">
            <h3 id="hidden-h" className="text-sm font-semibold text-charcoal">
              Hidden from Today
            </h3>
            <p className="text-xs text-muted-foreground">
              These places remain available elsewhere in VeggieMeet.
            </p>
            {hidden.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is hidden from Today.</p>
            ) : (
              <ul className="space-y-2">
                {hidden.map((p) => (
                  <Row key={p.place_id} place={p}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`Return ${p.name} to automatic recommendations`}
                      onClick={() => stateM.mutate({ place: p, state: "normal" })}
                    >
                      Return to automatic recommendations
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      aria-label={`Feature ${p.name} on Today`}
                      onClick={() => stateM.mutate({ place: p, state: "featured" })}
                    >
                      Feature on Today
                    </Button>
                  </Row>
                ))}
              </ul>
            )}
          </section>

          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
            </p>
          )}
        </>
      )}
    </div>
  );
}

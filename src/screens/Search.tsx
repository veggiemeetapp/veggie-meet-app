import { safeBack } from "@/lib/navigation";
import { BackButton } from "@/components/app";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext } from "@/hooks/useLocation";
import { supabase } from "@/integrations/supabase/client";
import { SearchInput } from "@/components/search/SearchInput";
import { SearchTabs } from "@/components/search/SearchTabs";
import { CityScopeChip } from "@/components/search/CityScopeChip";
import { SearchSuggestions } from "@/components/search/SearchSuggestions";
import { RecentSearches } from "@/components/search/RecentSearches";
import { VeggieResultCard } from "@/components/search/VeggieResultCard";
import { MeetupResultCard } from "@/components/search/MeetupResultCard";
import { PlaceResultCard } from "@/components/search/PlaceResultCard";
import { ResultSkeleton } from "@/components/search/ResultSkeleton";
import { SearchEmptyState } from "@/components/search/SearchEmptyState";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import {
  useSearchAll,
  useSearchMeetupsInfinite,
  useSearchPlacesInfinite,
  useSearchVeggiesInfinite,
} from "@/hooks/useSearch";

export type ResultTab = "all" | "veggies" | "meetups" | "places";

export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const location = useLocationContext();
  const selectedCity = location.data?.selected_city ?? null;
  const qc = useQueryClient();
  const { recent, push, remove, clear } = useRecentSearches();

  const initialQ = params.get("q") ?? "";
  const initialTab = (params.get("type") as ResultTab) ?? "all";
  const initialScope = params.get("scope") === "all";

  const [query, setQuery] = useState(initialQ);
  const [tab, setTab] = useState<ResultTab>(initialTab);
  const [allCities, setAllCities] = useState(initialScope);

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (tab !== "all") next.set("type", tab);
    if (allCities) next.set("scope", "all");
    setParams(next, { replace: true });
  }, [query, tab, allCities, setParams]);

  const cityId = allCities ? null : selectedCity?.id ?? null;
  const trimmed = query.trim();
  const hasQuery = trimmed.length >= 2;

  // Persist to recent when a query stabilizes
  useEffect(() => {
    if (!hasQuery) return;
    const t = window.setTimeout(() => push(trimmed), 800);
    return () => window.clearTimeout(t);
  }, [trimmed, hasQuery, push]);

  const allQ = useSearchAll(query, cityId, allCities);
  const vQ = useSearchVeggiesInfinite(query, cityId, allCities, {});
  const mQ = useSearchMeetupsInfinite(query, cityId, allCities, {});
  const pQ = useSearchPlacesInfinite(query, cityId, allCities, {});

  // Realtime invalidation while on Search
  useEffect(() => {
    if (!profile?.id) return;
    const invalidate = () => qc.invalidateQueries({ queryKey: ["search"] });
    const ch = supabase
      .channel(`search-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_blocks" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetups" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.id, qc]);

  const dedupe = <T extends { entity_id: string }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const r of rows) if (!seen.has(r.entity_id)) { seen.add(r.entity_id); out.push(r); }
    return out;
  };
  const veggies = useMemo(() => dedupe(vQ.data?.pages.flatMap((p) => p.items) ?? []), [vQ.data]);
  const meetups = useMemo(() => dedupe(mQ.data?.pages.flatMap((p) => p.items) ?? []), [mQ.data]);
  const places = useMemo(() => dedupe(pQ.data?.pages.flatMap((p) => p.items) ?? []), [pQ.data]);
  const allData = useMemo(() => {
    if (!allQ.data) return allQ.data;
    return {
      veggies: dedupe(allQ.data.veggies),
      meetups: dedupe(allQ.data.meetups),
      places: dedupe(allQ.data.places),
    };
  }, [allQ.data]);

  return (
    <div className="pb-16 animate-fade-in">
      <h1 className="sr-only">Search Veggies, Meetups, and Places</h1>
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border page-x pt-3 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <BackButton fallback="/community" />
          <div className="flex-1">
            <SearchInput
              value={query}
              onChange={setQuery}
              onClear={() => setQuery("")}
              autoFocus
            />
          </div>
        </div>
        {/* DEF-092A-02: at 320px the city chip and the tab rail could not both
            fit on one line, pushing 51px of horizontal overflow. Allow the row
            to wrap and let the tab rail shrink instead of forcing its width. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CityScopeChip
            cityName={selectedCity?.name ?? null}
            allCities={allCities}
            onToggle={() => setAllCities((s) => !s)}
          />
          <div className="flex-1 min-w-[13rem] max-w-xs">
            <SearchTabs value={tab} onChange={setTab} />
          </div>
        </div>

      </div>

      <div className="pt-4">
        {!hasQuery ? (
          <div className="space-y-6">
            <SearchSuggestions cityName={selectedCity?.name ?? null} onPick={setQuery} />
            <RecentSearches items={recent} onPick={setQuery} onRemove={remove} onClear={clear} />
            {recent.length === 0 && (
              <p className="px-5 text-xs text-charcoal-muted">
                Search Veggies, Meetups, and Places. Type at least 2 characters.
              </p>
            )}
          </div>
        ) : tab === "all" ? (
          <AllPanel
            loading={allQ.isPending}
            error={allQ.isError}
            data={allData}
            onSeeAll={setTab}
            cityName={selectedCity?.name ?? null}
            allCities={allCities}
            onExpand={() => setAllCities(true)}
          />
        ) : tab === "veggies" ? (
          <ListPanel
            loading={vQ.isPending}
            error={vQ.isError}
            items={veggies}
            hasMore={!!vQ.hasNextPage}
            loadingMore={vQ.isFetchingNextPage}
            onLoadMore={() => vQ.fetchNextPage()}
            renderItem={(v) => <VeggieResultCard key={v.entity_id} result={v} />}
            emptyLabel="No Veggies found"
            cityName={selectedCity?.name ?? null}
            allCities={allCities}
            onExpand={() => setAllCities(true)}
          />
        ) : tab === "meetups" ? (
          <ListPanel
            loading={mQ.isPending}
            error={mQ.isError}
            items={meetups}
            hasMore={!!mQ.hasNextPage}
            loadingMore={mQ.isFetchingNextPage}
            onLoadMore={() => mQ.fetchNextPage()}
            renderItem={(m) => <MeetupResultCard key={m.entity_id} result={m} />}
            emptyLabel="No Meetups found"
            cityName={selectedCity?.name ?? null}
            allCities={allCities}
            onExpand={() => setAllCities(true)}
          />
        ) : (
          <ListPanel
            loading={pQ.isPending}
            error={pQ.isError}
            items={places}
            hasMore={!!pQ.hasNextPage}
            loadingMore={pQ.isFetchingNextPage}
            onLoadMore={() => pQ.fetchNextPage()}
            renderItem={(p) => <PlaceResultCard key={p.entity_id} result={p} />}
            emptyLabel="No Places found"
            cityName={selectedCity?.name ?? null}
            allCities={allCities}
            onExpand={() => setAllCities(true)}
          />
        )}
      </div>
    </div>
  );
}

/* -------- Panels -------- */

function AllPanel({
  loading,
  error,
  data,
  onSeeAll,
  cityName,
  allCities,
  onExpand,
}: {
  loading: boolean;
  error: boolean;
  data: { veggies: any[]; meetups: any[]; places: any[] } | undefined;
  onSeeAll: (t: ResultTab) => void;
  cityName: string | null;
  allCities: boolean;
  onExpand: () => void;
}) {
  if (loading) {
    return (
      <div className="px-5 space-y-5">
        <ResultSkeleton />
      </div>
    );
  }
  if (error) return <ErrorRow />;
  const empty =
    !data ||
    (data.veggies.length === 0 && data.meetups.length === 0 && data.places.length === 0);
  if (empty) {
    return <SearchEmptyState cityName={cityName} allCities={allCities} onExpand={onExpand} />;
  }
  return (
    <div className="space-y-6 px-5">
      {data!.veggies.length > 0 && (
        <SectionPreview
          heading="Veggies"
          onSeeAll={() => onSeeAll("veggies")}
          items={data!.veggies.map((v) => (
            <VeggieResultCard key={v.entity_id} result={v} />
          ))}
        />
      )}
      {data!.meetups.length > 0 && (
        <SectionPreview
          heading="Meetups"
          onSeeAll={() => onSeeAll("meetups")}
          items={data!.meetups.map((m) => (
            <MeetupResultCard key={m.entity_id} result={m} />
          ))}
        />
      )}
      {data!.places.length > 0 && (
        <SectionPreview
          heading="Places"
          onSeeAll={() => onSeeAll("places")}
          items={data!.places.map((p) => (
            <PlaceResultCard key={p.entity_id} result={p} />
          ))}
        />
      )}
    </div>
  );
}

function SectionPreview({
  heading,
  items,
  onSeeAll,
}: {
  heading: string;
  items: React.ReactNode[];
  onSeeAll: () => void;
}) {
  return (
    <section aria-label={heading}>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
          {heading}
        </h2>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs text-primary hover:underline"
        >
          See all
        </button>
      </div>
      <div className="space-y-3">{items}</div>
    </section>
  );
}

function ListPanel<T extends { entity_id: string }>({
  loading,
  error,
  items,
  hasMore,
  loadingMore,
  onLoadMore,
  renderItem,
  emptyLabel,
  cityName,
  allCities,
  onExpand,
}: {
  loading: boolean;
  error: boolean;
  items: T[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  renderItem: (item: T) => React.ReactNode;
  emptyLabel: string;
  cityName: string | null;
  allCities: boolean;
  onExpand: () => void;
}) {
  if (loading) {
    return (
      <div className="px-5">
        <ResultSkeleton />
      </div>
    );
  }
  if (error) return <ErrorRow />;
  if (items.length === 0) {
    return (
      <SearchEmptyState cityName={cityName} allCities={allCities} onExpand={onExpand} />
    );
  }
  return (
    <div className="px-5 space-y-3">
      <div className="sr-only" aria-live="polite">
        {items.length} {emptyLabel.replace("No ", "").replace(" found", "")} results
      </div>
      {items.map((it) => renderItem(it))}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="w-full h-11 rounded-full border border-border/70 text-sm font-medium text-charcoal hover:bg-muted/50 disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function ErrorRow() {
  return (
    <div className="mx-5 rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-charcoal-muted">
      Search is unavailable right now. Please try again.
    </div>
  );
}

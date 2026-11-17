import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MapPin, Plane, Users } from "lucide-react";
import { Card, EmptyState, SecondaryButton, UserAvatar } from "@/components/app";
import { ResultReasonPill } from "@/components/search/ResultReasonPill";
import { ResultSkeleton } from "@/components/search/ResultSkeleton";
import { DIETARY_OPTIONS } from "@/lib/onboarding";
import { memberSafeMessage } from "@/lib/errors";
import {
  DIETARY_FILTER_VALUES,
  formatTripRange,
  type DietaryFilter,
  type PresenceFilters,
  type VeggieHereResult,
} from "@/lib/trips";
import { useTripOverlapsInfinite, useVeggiesHereInfinite } from "@/hooks/useTrips";

/**
 * Filterable, paginated list of members present in a city — either today
 * (`city` mode) or during one of my trips (`trip` mode). Shared by the
 * Veggies here screen and the trip overlap screen.
 */
export type PresenceSource =
  | { kind: "city"; cityId: string | null }
  | { kind: "trip"; tripId: string | null };

interface Props {
  source: PresenceSource;
  cityName: string | null;
  /** Rendered above the list once the first page has loaded (e.g. a CTA). */
  header?: (total: number) => ReactNode;
  /** Rendered inside the empty state. */
  emptyAction?: ReactNode;
}

type ChipKey = "all" | DietaryFilter | "visiting" | "hosts" | "shared";

const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "vegan", label: "Vegan" },
  { key: "vegetarian", label: "Vegetarian" },
  { key: "plant_based", label: "Plant-based" },
  { key: "veg_curious", label: "Veg-curious" },
  { key: "visiting", label: "Visiting" },
  { key: "hosts", label: "Active Hosts" },
  { key: "shared", label: "Shares my interests" },
];

function filtersFor(active: Set<ChipKey>): PresenceFilters {
  const dietary = [...active].filter((k): k is DietaryFilter =>
    (DIETARY_FILTER_VALUES as readonly string[]).includes(k),
  );
  return {
    dietary: dietary.length ? dietary : undefined,
    visitingOnly: active.has("visiting"),
    hostsOnly: active.has("hosts"),
    sharedOnly: active.has("shared"),
  };
}

export function VeggiePresenceList({ source, cityName, header, emptyAction }: Props) {
  const [active, setActive] = useState<Set<ChipKey>>(new Set(["all"]));
  const filters = useMemo(() => filtersFor(active), [active]);

  // Both hooks are declared (rules of hooks); only the relevant one is enabled.
  const cityQ = useVeggiesHereInfinite(source.kind === "city" ? source.cityId : null, filters);
  const tripQ = useTripOverlapsInfinite(source.kind === "trip" ? source.tripId : null, filters);
  const q = source.kind === "city" ? cityQ : tripQ;

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: VeggieHereResult[] = [];
    for (const page of q.data?.pages ?? []) {
      for (const r of page.items) {
        if (!seen.has(r.entity_id)) {
          seen.add(r.entity_id);
          out.push(r);
        }
      }
    }
    return out;
  }, [q.data]);
  const total = q.data?.pages[0]?.total ?? 0;
  const filtering = !active.has("all");

  const toggle = (key: ChipKey) =>
    setActive((prev) => {
      if (key === "all") return new Set(["all"]);
      const next = new Set(prev);
      next.delete("all");
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) next.add("all");
      return next;
    });

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Filter veggies"
        className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-1"
      >
        {CHIPS.map((c) => {
          const on = active.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c.key)}
              className={`shrink-0 inline-flex items-center h-8 px-3 rounded-full border text-xs font-medium transition-colors ${
                on
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/60 border-border/60 text-charcoal hover:bg-muted"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {q.isPending ? (
        <ResultSkeleton />
      ) : q.isError ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="We couldn't load veggies right now."
          description={memberSafeMessage(q.error)}
          action={<SecondaryButton size="sm" onClick={() => q.refetch()}>Try again</SecondaryButton>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title={
            filtering
              ? "No veggies match these filters."
              : cityName
                ? `No veggies in ${cityName} yet.`
                : "No veggies here yet."
          }
          description={
            filtering
              ? "Try removing a filter."
              : "Be the first — add a trip or host a meetup so others can find you."
          }
          action={
            filtering ? (
              <SecondaryButton size="sm" onClick={() => setActive(new Set(["all"]))}>
                Clear filters
              </SecondaryButton>
            ) : (
              emptyAction
            )
          }
        />
      ) : (
        <>
          {header?.(total)}
          <p className="text-xs text-charcoal-muted" role="status">
            {total} {total === 1 ? "veggie" : "veggies"}
            {cityName ? ` in ${cityName}` : ""}
            {filtering ? " match" : ""}
          </p>
          <ul className="space-y-3">
            {items.map((r) => (
              <li key={r.entity_id}>
                <VeggiePresenceCard result={r} />
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <SecondaryButton
              size="sm"
              fullWidth
              disabled={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              {q.isFetchingNextPage ? "Loading…" : "Show more"}
            </SecondaryButton>
          )}
        </>
      )}
    </div>
  );
}

const relLabel: Record<VeggieHereResult["relationship"], string | null> = {
  none: null,
  pending: "Requested",
  connected: "Connected",
  verified: "Verified",
};

function dietaryLabel(id: string | null): string | null {
  if (!id || id === "other") return null;
  return DIETARY_OPTIONS.find((o) => o.id === id)?.label ?? null;
}

export function VeggiePresenceCard({ result }: { result: VeggieHereResult }) {
  const visiting = result.presence === "visiting";
  const diet = dietaryLabel(result.dietary_identity);
  return (
    <Link
      to={`/veggie/${result.entity_id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-card"
    >
      <Card interactive padding="md" className="flex gap-3 items-start">
        <UserAvatar name={result.display_name} src={result.avatar_url ?? undefined} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold text-sm text-charcoal truncate">{result.display_name}</h3>
            {relLabel[result.relationship] && (
              <span className="text-[10px] font-medium text-charcoal-muted shrink-0">
                {relLabel[result.relationship]}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-charcoal-muted mt-0.5">
            {visiting && result.visit_start && result.visit_end ? (
              <span className="inline-flex items-center gap-1 text-primary font-medium">
                <Plane className="w-3 h-3" aria-hidden />
                Visiting {formatTripRange(result.visit_start, result.visit_end)}
              </span>
            ) : result.city_name ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" aria-hidden />
                <span className="truncate">Lives in {result.city_name}</span>
              </span>
            ) : null}
            {diet && <span>· {diet}</span>}
            {result.is_active_host && <span className="text-primary">· Active Host</span>}
          </div>
          {result.bio && <p className="text-xs text-charcoal-muted mt-1 line-clamp-2">{result.bio}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ResultReasonPill label={result.reason_label} />
          </div>
        </div>
      </Card>
    </Link>
  );
}

import { safeBack } from "@/lib/navigation";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { SuggestionQueue } from "@/components/owner/SuggestionQueue";
import { ReportQueue } from "@/components/owner/ReportQueue";
import { PlaceMaintenance } from "@/components/owner/PlaceMaintenance";
import { ReverificationQueue } from "@/components/owner/ReverificationQueue";
import CandidateWorkspace from "@/components/owner/CandidateWorkspace";

import { isOwner } from "@/lib/placeVerification";
import { logAnalyticsEvent } from "@/lib/analytics";
import { fieldLabelList } from "@/lib/fieldLabels";
import {
  ACTIVITY_LABEL,
  ATTENTION_LABEL,
  ATTENTION_NEXT_ACTION,
  CATEGORY_LABEL,
  FRESHNESS_LABEL,
  HEALTH_LABEL,
  HEALTH_TONE,
  MAINT_LABEL,
  URGENCY_LABEL,
  VEGAN_LABEL,
  attentionLink,
  fetchActivityPage,
  fetchOperationsDashboard,
  formatDate,
  formatDateTime,
  humanLabel,
  urgencyOf,
  type ActivityItem,
  type ActivityKind,
  type AttentionItem,
  type AttentionType,
  type PlaceHealthRow,
} from "@/lib/ownerOperations";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "suggestions", label: "Suggestions" },
  { value: "reports", label: "Reports" },
  { value: "reverification", label: "Reverification" },
  { value: "maintenance", label: "Maintenance" },
  { value: "candidates", label: "Candidates" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

/** Owner-safe, non-identifying summary line for a recent-activity row. */
function activitySummary(a: ActivityItem): string {
  switch (a.kind) {
    case "public_details_updated":
      return `Updated: ${fieldLabelList((a.detail_a ?? "").split(",").filter(Boolean))}`;
    case "operational_status_changed":
      return `Now ${humanLabel(MAINT_LABEL, a.detail_a)}`;
    case "place_reverified":
      return a.detail_a ? `Outcome: ${a.detail_a.replace(/_/g, " ")}` : "Freshness refreshed";
    case "vegan_status_reviewed":
      return a.detail_b
        ? `Classification: ${humanLabel(VEGAN_LABEL, a.detail_b)}`
        : "Review recorded";
    case "vegan_classification_changed":
      return `${humanLabel(VEGAN_LABEL, a.detail_b)} → ${humanLabel(VEGAN_LABEL, a.detail_a)}`;
    case "suggestion_moderated":
      return `Decision: ${(a.detail_a ?? "").replace(/_/g, " ") || "recorded"}`;
    case "report_resolved":
      return `Closed as ${(a.detail_a ?? "").replace(/_/g, " ") || "resolved"}`;
    case "candidate_published":
      return "Published to Community Places";
    case "place_activated":
      return "Visible in discovery again";
    case "place_deactivated":
      return "Removed from discovery";
    default:
      return "Recorded privately";
  }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground leading-snug">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        tone ?? "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

export default function OwnerPlaceOperations() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") as TabValue) ?? "overview";
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");

  const ownerQ = useQuery({ queryKey: ["is-owner"], queryFn: isOwner });

  const dashQ = useQuery({
    queryKey: ["place-operations-dashboard"],
    queryFn: fetchOperationsDashboard,
    enabled: ownerQ.data === true,
  });

  const activityQ = useInfiniteQuery({
    queryKey: ["place-operations-activity"],
    queryFn: ({ pageParam }) =>
      fetchActivityPage(pageParam as { before_at: string; before_id: string } | undefined),
    initialPageParam: undefined as { before_at: string; before_id: string } | undefined,
    getNextPageParam: (last) => {
      if (!last.has_more || last.items.length === 0) return undefined;
      const tailItem = last.items[last.items.length - 1];
      return { before_at: tailItem.occurred_at, before_id: tailItem.id };
    },
    enabled: ownerQ.data === true && tab === "overview",
  });

  function setTab(next: string) {
    const p = new URLSearchParams(params);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  }

  function goto(link: { to?: string; tab?: string }) {
    if (link.to) navigate(link.to);
    else if (link.tab) setTab(link.tab);
  }

  const filtersActive =
    search.trim().length > 0 ||
    [typeFilter, urgencyFilter, visibilityFilter, statusFilter, healthFilter].some(
      (v) => v !== "all",
    );

  function resetFilters() {
    setSearch("");
    setTypeFilter("all");
    setUrgencyFilter("all");
    setVisibilityFilter("all");
    setStatusFilter("all");
    setHealthFilter("all");
  }

  const term = search.trim().toLowerCase();

  const attention = useMemo<AttentionItem[]>(() => {
    const items = dashQ.data?.attention ?? [];
    const places = dashQ.data?.places ?? [];
    return items.filter((i) => {
      if (term && !i.title.toLowerCase().includes(term)) return false;
      // Attention items are deduplicated per place, so a single row can carry
      // several reasons. Match the primary reason OR any merged secondary one,
      // otherwise filtering by e.g. "Open issue report" would hide a place
      // whose top reason happens to be a review in progress.
      const allTypes = [i.item_type, ...i.secondary_types.map((s) => s.type)];
      if (typeFilter !== "all" && !allTypes.includes(typeFilter as AttentionType)) return false;
      if (
        urgencyFilter !== "all" &&
        !allTypes.some((t) => urgencyOf(t) === urgencyFilter)
      )
        return false;
      const p = places.find((x) => x.id === i.entity_id);
      if (visibilityFilter !== "all") {
        if (!p) return false;
        if (visibilityFilter === "active" && !p.is_active) return false;
        if (visibilityFilter === "hidden" && p.is_active) return false;
      }
      if (statusFilter !== "all" && (!p || p.maintenance_status !== statusFilter)) return false;
      if (healthFilter !== "all" && (!p || p.health !== healthFilter)) return false;
      return true;
    });
  }, [dashQ.data, term, typeFilter, urgencyFilter, visibilityFilter, statusFilter, healthFilter]);

  const places = useMemo<PlaceHealthRow[]>(() => {
    const rows = dashQ.data?.places ?? [];
    return rows.filter((p) => {
      if (term && !p.name.toLowerCase().includes(term)) return false;
      if (visibilityFilter === "active" && !p.is_active) return false;
      if (visibilityFilter === "hidden" && p.is_active) return false;
      if (statusFilter !== "all" && p.maintenance_status !== statusFilter) return false;
      if (healthFilter !== "all" && p.health !== healthFilter) return false;
      return true;
    });
  }, [dashQ.data, term, visibilityFilter, statusFilter, healthFilter]);

  if (ownerQ.isLoading) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (ownerQ.data !== true) {
    return (
      <div className="flex-1 grid place-items-center p-6 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Permission denied</h1>
          <p className="text-sm text-muted-foreground">
            This area is limited to the VeggieMeet owner.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>
            Back to Today
          </Button>
        </div>
      </div>
    );
  }

  const s = dashQ.data?.summary;
  const q = dashQ.data?.queues;
  const activityItems = (activityQ.data?.pages ?? []).flatMap((p) => p.items);

  return (
    <div className="flex-1 flex flex-col pb-24">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="mx-auto w-full max-w-5xl flex items-start gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => safeBack(navigate, "/you")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Community Place operations</h1>
            <p className="text-xs text-muted-foreground">
              Review places, handle community reports, and keep verified information accurate.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl p-4">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            logAnalyticsEvent("community_place_operations_filter_changed", { filter_type: "tab" });
          }}
        >
          <div className="-mx-4 px-4 overflow-x-auto">
            <TabsList className="w-max">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ---------------- Overview ---------------- */}
          <TabsContent value="overview" className="space-y-6 pt-4">
            {dashQ.isError && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-2"
              >
                <p className="text-sm font-medium">We couldn't load the operations overview.</p>
                <p className="text-xs text-muted-foreground">
                  Nothing was changed. Try again in a moment.
                </p>
                <Button size="sm" variant="outline" onClick={() => dashQ.refetch()}>
                  <RefreshCw className="h-4 w-4 mr-1.5" /> Try again
                </Button>
              </div>
            )}

            {/* Summary */}
            <section aria-labelledby="ops-summary" className="space-y-2">
              <h2 id="ops-summary" className="text-sm font-semibold">
                Operational summary
              </h2>
              {dashQ.isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-[68px] rounded-xl" />
                  ))}
                </div>
              ) : s ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Metric label="Published places" value={s.published_places} />
                  <Metric label="Active places" value={s.active_places} />
                  <Metric label="Hidden places" value={s.hidden_places} />
                  <Metric label="Places needing attention" value={s.places_needing_attention} />
                  <Metric label="Open suggestions" value={s.open_suggestions} />
                  <Metric label="Open reports" value={s.open_reports} />
                  <Metric label="Reverification due" value={s.reverification_due} />
                  <Metric label="Reviews in progress" value={s.reviews_in_progress} />
                </div>
              ) : null}
              {s && (
                <p className="text-xs text-muted-foreground">
                  Also: {s.reverification_due_soon} due soon · {s.candidates_total} candidates ·{" "}
                  {s.attention_items} attention items in total.
                </p>
              )}
            </section>

            {/* Filters */}
            <section aria-labelledby="ops-filters" className="space-y-2">
              <h2 id="ops-filters" className="text-sm font-semibold">
                Search and filters
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="ops-search">Search by name</Label>
                  <Input
                    id="ops-search"
                    value={search}
                    placeholder="Place or submission name"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ops-type">Item type</Label>
                  <Select
                    value={typeFilter}
                    onValueChange={(v) => {
                      setTypeFilter(v);
                      logAnalyticsEvent("community_place_operations_filter_changed", {
                        filter_type: "item_type",
                      });
                    }}
                  >
                    <SelectTrigger id="ops-type">
                      <SelectValue placeholder="All item types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All item types</SelectItem>
                      {(Object.keys(ATTENTION_LABEL) as AttentionType[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {ATTENTION_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ops-urgency">Urgency</Label>
                  <Select
                    value={urgencyFilter}
                    onValueChange={(v) => {
                      setUrgencyFilter(v);
                      logAnalyticsEvent("community_place_operations_filter_changed", {
                        filter_type: "urgency",
                      });
                    }}
                  >
                    <SelectTrigger id="ops-urgency">
                      <SelectValue placeholder="Any urgency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any urgency</SelectItem>
                      {Object.entries(URGENCY_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ops-visibility">Visibility</Label>
                  <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
                    <SelectTrigger id="ops-visibility">
                      <SelectValue placeholder="Active and hidden" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Active and hidden</SelectItem>
                      <SelectItem value="active">Active only</SelectItem>
                      <SelectItem value="hidden">Hidden only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ops-status">Operational status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger id="ops-status">
                      <SelectValue placeholder="Any status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any status</SelectItem>
                      {Object.entries(MAINT_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ops-health">Health state</Label>
                  <Select value={healthFilter} onValueChange={setHealthFilter}>
                    <SelectTrigger id="ops-health">
                      <SelectValue placeholder="Any health state" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any health state</SelectItem>
                      {Object.entries(HEALTH_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Reset filters
                </Button>
              )}
            </section>

            {/* Attention queue */}
            <section aria-labelledby="ops-attention" className="space-y-2">
              <h2 id="ops-attention" className="text-sm font-semibold">
                Needs attention
              </h2>
              {dashQ.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                </div>
              ) : attention.length === 0 ? (
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-sm font-medium">
                    {filtersActive ? "No matching attention items" : "Everything is up to date"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {filtersActive
                      ? "No Community Place tasks match your search and filters. Reset filters to see everything."
                      : "There are no Community Place tasks requiring attention right now."}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {attention.map((i) => {
                    const link = attentionLink(i);
                    const urgency = urgencyOf(i.item_type);
                    return (
                      <li
                        key={`${i.entity_kind}-${i.entity_id}`}
                        className="rounded-xl border bg-card p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold break-words">{i.title}</h3>
                            <p className="text-xs text-muted-foreground">
                              {ATTENTION_LABEL[i.item_type]}
                              {i.subtitle ? ` · ${i.subtitle}` : ""}
                            </p>
                          </div>
                          <Chip
                            tone={
                              urgency === "blocker" || urgency === "high"
                                ? "bg-destructive/10 text-destructive"
                                : undefined
                            }
                          >
                            {URGENCY_LABEL[urgency]}
                          </Chip>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ATTENTION_NEXT_ACTION[i.item_type]}
                        </p>
                        {i.secondary_types.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[11px] text-muted-foreground">Also:</span>
                            {i.secondary_types.map((sec) => {
                              const secLink = attentionLink({ ...i, item_type: sec.type });
                              return (
                                <button
                                  key={sec.type}
                                  onClick={() => goto(secLink)}
                                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground underline-offset-2 hover:underline"
                                >
                                  {ATTENTION_LABEL[sec.type]}
                                  {sec.type === "open_report" && i.open_reports_count > 1
                                    ? ` (${i.open_reports_count})`
                                    : ""}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-3 pt-0.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              logAnalyticsEvent("community_place_operations_attention_opened", {
                                item_type: i.item_type,
                                urgency,
                              });
                              goto(link);
                            }}
                          >
                            {link.label}
                          </Button>
                          <span className="text-[11px] text-muted-foreground">
                            Updated {formatDate(i.occurred_at)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Place health */}
            <section aria-labelledby="ops-health-list" className="space-y-2">
              <h2 id="ops-health-list" className="text-sm font-semibold">
                Place health
              </h2>
              {dashQ.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-32 rounded-xl" />
                  <Skeleton className="h-32 rounded-xl" />
                </div>
              ) : places.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No published places match your search and filters.
                </p>
              ) : (
                <ul className="grid gap-2 lg:grid-cols-2">
                  {places.map((p) => (
                    <li key={p.id} className="rounded-xl border bg-card p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold break-words">{p.name}</h3>
                          <p className="text-xs text-muted-foreground">
                            {p.neighborhood ?? "Area not set"} ·{" "}
                            {humanLabel(CATEGORY_LABEL, p.category)}
                          </p>
                        </div>
                        <Chip tone={HEALTH_TONE[p.health]}>{HEALTH_LABEL[p.health]}</Chip>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Chip>{p.is_active ? "Visible" : "Hidden"}</Chip>
                        <Chip>{humanLabel(MAINT_LABEL, p.maintenance_status)}</Chip>
                        <Chip>{humanLabel(VEGAN_LABEL, p.veggie_classification)}</Chip>
                        <Chip>{humanLabel(FRESHNESS_LABEL, p.freshness)}</Chip>
                        {p.open_reports_count > 0 && (
                          <Chip>{p.open_reports_count} open reports</Chip>
                        )}
                        {p.open_reviews_count > 0 && (
                          <Chip>{p.open_reviews_count} open reviews</Chip>
                        )}
                        <Chip>{p.has_google_place_id ? "Google Place ID set" : "No Google Place ID"}</Chip>
                      </div>

                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <div>
                          <dt className="inline">First verified: </dt>
                          <dd className="inline">{formatDate(p.verified_at)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Last reverified: </dt>
                          <dd className="inline">{formatDate(p.last_reverified_at)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Supported by: </dt>
                          <dd className="inline">{p.supported_count} veggies</dd>
                        </div>
                        <div>
                          <dt className="inline">Hosting / check-in: </dt>
                          <dd className="inline">
                            {p.hosting_eligible ? "Allowed" : "Blocked"} /{" "}
                            {p.check_in_eligible ? "Allowed" : "Blocked"}
                          </dd>
                        </div>
                      </dl>

                      <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-0.5 text-xs">
                        {[
                          { label: `View public page for ${p.name}`, short: "View public page", to: `/place/${p.id}` },
                          { label: `Edit public details for ${p.name}`, short: "Edit public details", to: `/owner/places/${p.id}/edit` },
                          { label: `Reverify ${p.name}`, short: "Reverification", to: `/owner/places/${p.id}/reverify` },
                          { label: `Review vegan status for ${p.name}`, short: "Vegan status", to: `/owner/places/${p.id}/vegan-review` },
                          { label: `Review place identity for ${p.name}`, short: "Place identity", to: `/owner/places/${p.id}/identity-review` },
                        ].map((a) => (
                          <button
                            key={a.short}
                            aria-label={a.label}
                            className="text-primary underline-offset-2 hover:underline"
                            onClick={() => {
                              logAnalyticsEvent("community_place_operations_place_opened", {
                                health_state: p.health,
                                source: a.short,
                              });
                              navigate(a.to);
                            }}
                          >
                            {a.short}
                          </button>
                        ))}
                        <button
                          className="text-primary underline-offset-2 hover:underline"
                          aria-label={`Open maintenance and audit history for ${p.name}`}
                          onClick={() => setTab("maintenance")}
                        >
                          Maintenance &amp; history
                        </button>
                        <button
                          className="text-primary underline-offset-2 hover:underline"
                          aria-label={`View issue reports for ${p.name}`}
                          onClick={() => setTab("reports")}
                        >
                          Issue reports
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Queue counts */}
            {q && (
              <section aria-labelledby="ops-queues" className="space-y-2">
                <h2 id="ops-queues" className="text-sm font-semibold">
                  Queue overview
                </h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(
                    [
                      ["Community suggestions", q.suggestions, "suggestions"],
                      ["Issue reports", q.reports, "reports"],
                      ["Reverification", q.reverifications, "reverification"],
                      ["Vegan reviews", q.vegan_reviews, undefined],
                      ["Identity reviews", q.identity_reviews, undefined],
                      ["Candidates", q.candidates, "candidates"],
                    ] as Array<[string, Record<string, number>, TabValue | undefined]>
                  ).map(([label, counts, target]) => (
                    <div key={label} className="rounded-xl border bg-card p-3 space-y-1">
                      <p className="text-xs font-medium">{label}</p>
                      {Object.keys(counts).length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">Nothing recorded yet</p>
                      ) : (
                        <ul className="text-[11px] text-muted-foreground space-y-0.5">
                          {Object.entries(counts).map(([k, v]) => (
                            <li key={k}>
                              {k.replace(/_/g, " ")}: <span className="tabular-nums">{v}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {target && (
                        <button
                          className="text-[11px] text-primary underline-offset-2 hover:underline"
                          onClick={() => setTab(target)}
                        >
                          Open {label.toLowerCase()}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Recent activity */}
            <section aria-labelledby="ops-activity" className="space-y-2">
              <h2 id="ops-activity" className="text-sm font-semibold">
                Recent Community Place activity
              </h2>
              {activityQ.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 rounded-xl" />
                  <Skeleton className="h-14 rounded-xl" />
                </div>
              ) : activityQ.isError ? (
                <div role="alert" aria-live="polite" className="rounded-xl border p-3 space-y-2">
                  <p className="text-sm">We couldn't load recent activity.</p>
                  <Button size="sm" variant="outline" onClick={() => activityQ.refetch()}>
                    Try again
                  </Button>
                </div>
              ) : activityItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent Community Place activity</p>
              ) : (
                <>
                  <ol className="space-y-2">
                    {activityItems.map((a) => (
                      <li key={`${a.source}-${a.id}`} className="rounded-xl border bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium break-words">
                              {ACTIVITY_LABEL[a.kind as ActivityKind] ?? "Activity recorded"}
                            </p>
                            <p className="text-xs text-muted-foreground break-words">
                              {a.place_name ?? "Community Place"} · {activitySummary(a)}
                            </p>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {formatDateTime(a.occurred_at)}
                          </span>
                        </div>
                        {a.place_id && (
                          <button
                            className="mt-1 text-[11px] text-primary underline-offset-2 hover:underline"
                            onClick={() => navigate(`/place/${a.place_id}`)}
                          >
                            View place <ExternalLink className="inline h-3 w-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                  {activityQ.hasNextPage && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={activityQ.isFetchingNextPage}
                      onClick={() => {
                        logAnalyticsEvent("community_place_operations_activity_loaded_more");
                        activityQ.fetchNextPage();
                      }}
                    >
                      {activityQ.isFetchingNextPage ? "Loading…" : "Load more"}
                    </Button>
                  )}
                </>
              )}
            </section>
          </TabsContent>

          <TabsContent value="suggestions" className="pt-4">
            <SuggestionQueue onPromoted={() => setTab("candidates")} />
          </TabsContent>
          <TabsContent value="reports" className="pt-4">
            <ReportQueue />
          </TabsContent>
          <TabsContent value="reverification" className="pt-4">
            <ReverificationQueue />
          </TabsContent>
          <TabsContent value="maintenance" className="pt-4">
            <PlaceMaintenance />
          </TabsContent>
          <TabsContent value="candidates" className="pt-4">
            <CandidateWorkspace />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

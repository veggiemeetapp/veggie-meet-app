import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InterestOption } from "@/lib/onboarding";
import { filterInterests, groupInterests } from "@/lib/interests";

/**
 * WO-124 — the single member-facing interest selector. Used by onboarding and
 * by profile editing with different bounds; the option list always comes from
 * the server catalogue, so both surfaces offer exactly the same taxonomy.
 */
export function InterestPicker({
  options,
  selected,
  onToggle,
  min,
  max,
  loading,
  searchable = true,
}: {
  options: InterestOption[];
  /** Selected canonical labels. */
  selected: string[];
  onToggle: (label: string) => void;
  min: number;
  max: number;
  loading?: boolean;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () => groupInterests(filterInterests(options, query)),
    [options, query],
  );
  const atMax = selected.length >= max;
  const remaining = Math.max(0, min - selected.length);

  if (loading) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="h-11 w-24 rounded-full bg-muted/60 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {searchable && (
        <div className="relative mb-4">
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search interests"
            placeholder="Search interests"
            className="w-full h-11 rounded-control border border-border bg-card pl-10 pr-4 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      <div className="space-y-5" role="group" aria-label="Interests">
        {groups.map((g) => (
          <div key={g.key}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-muted">
              {g.label}
            </h3>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => {
                const active = selected.includes(o.label);
                const blocked = !active && atMax;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={active}
                    disabled={blocked}
                    onClick={() => onToggle(o.label)}
                    className={cn(
                      "min-h-11 px-3.5 py-2 rounded-full text-sm font-medium border transition active:scale-[0.97]",
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-card text-charcoal border-border hover:bg-accent/60",
                      blocked && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    {active && <span className="mr-1.5" aria-hidden="true">✓</span>}
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-charcoal-muted">
            No interests match “{query.trim()}”.
          </p>
        )}
      </div>

      <p aria-live="polite" className="mt-4 text-xs text-charcoal-muted text-center">
        {atMax
          ? `That's the max — ${max} selected.`
          : remaining > 0
            ? remaining === 1
              ? "One more to go."
              : `Pick ${remaining} more.`
            : `${selected.length} selected — you can pick up to ${max}.`}
      </p>
    </div>
  );
}

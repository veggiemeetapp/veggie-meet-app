import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InterestOption } from "@/lib/onboarding";
import {
  MEETUP_MAX_ADDITIONAL_INTERESTS,
  filterInterests,
  groupInterests,
  labelForId,
  suggestInterestIds,
} from "@/lib/interests";

/**
 * WO-124 — Meetup interest tagging.
 *
 * One required primary interest ("what is this Meetup about?") plus up to two
 * optional additional interests, all drawn from the same server catalogue used
 * for member profiles. Suggestions are hints only; the host always confirms.
 */
export function MeetupInterestPicker({
  options,
  loading,
  primaryId,
  additionalIds,
  onPrimaryChange,
  onAdditionalChange,
  suggestFrom,
}: {
  options: InterestOption[];
  loading?: boolean;
  primaryId: string | null;
  additionalIds: string[];
  onPrimaryChange: (id: string | null) => void;
  onAdditionalChange: (ids: string[]) => void;
  /** Free text (title/description) used to offer optional suggestions. */
  suggestFrom?: string;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () => groupInterests(filterInterests(options, query)),
    [options, query],
  );

  const suggestions = useMemo(() => {
    if (!suggestFrom) return [];
    return suggestInterestIds(options, suggestFrom).filter(
      (id) => id !== primaryId && !additionalIds.includes(id),
    );
  }, [options, suggestFrom, primaryId, additionalIds]);

  function selectPrimary(id: string) {
    if (primaryId === id) {
      onPrimaryChange(null);
      onAdditionalChange([]);
      return;
    }
    onPrimaryChange(id);
    onAdditionalChange(additionalIds.filter((x) => x !== id));
  }

  function toggleAdditional(id: string) {
    if (id === primaryId) return;
    if (additionalIds.includes(id)) {
      onAdditionalChange(additionalIds.filter((x) => x !== id));
      return;
    }
    if (additionalIds.length >= MEETUP_MAX_ADDITIONAL_INTERESTS) return;
    onAdditionalChange([...additionalIds, id]);
  }

  if (loading) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="h-11 w-24 rounded-full bg-muted/60 animate-pulse" />
        ))}
      </div>
    );
  }

  const primaryLabel = labelForId(options, primaryId);
  const atAdditionalMax = additionalIds.length >= MEETUP_MAX_ADDITIONAL_INTERESTS;

  return (
    <div>
      <div className="relative mb-3">
        <Search
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search Meetup categories"
          placeholder="Search categories"
          className="w-full h-11 rounded-control border border-border bg-card pl-10 pr-4 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {suggestions.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold text-charcoal-muted">
            Suggested from your description
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => (primaryId ? toggleAdditional(id) : selectPrimary(id))}
                className="min-h-11 px-3.5 py-2 rounded-full text-sm font-medium border border-dashed border-primary/60 text-primary bg-card hover:bg-accent/60 transition"
              >
                + {labelForId(options, id)}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mb-2 text-sm font-semibold text-charcoal">
        Main category <span className="text-primary">*</span>
      </p>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key} role="group" aria-labelledby={`meetup-interest-group-${g.key}`}>
            <p
              id={`meetup-interest-group-${g.key}`}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-muted"
            >
              {g.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => {
                const isPrimary = primaryId === o.id;
                const isAdditional = additionalIds.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={isPrimary || isAdditional}
                    aria-label={
                      isPrimary
                        ? `${o.label} (main category)`
                        : isAdditional
                          ? `${o.label} (additional category)`
                          : o.label
                    }
                    onClick={() => (primaryId === null || isPrimary ? selectPrimary(o.id) : toggleAdditional(o.id))}
                    disabled={
                      primaryId !== null && !isPrimary && !isAdditional && atAdditionalMax
                    }
                    className={cn(
                      "min-h-11 px-3.5 py-2 rounded-full text-sm font-medium border transition active:scale-[0.97]",
                      isPrimary
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : isAdditional
                          ? "bg-accent text-charcoal border-primary/50"
                          : "bg-card text-charcoal border-border hover:bg-accent/60",
                      primaryId !== null &&
                        !isPrimary &&
                        !isAdditional &&
                        atAdditionalMax &&
                        "opacity-40 cursor-not-allowed",
                    )}
                  >
                    {isPrimary ? "★ " : isAdditional ? "✓ " : ""}
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

      <p aria-live="polite" className="mt-3 text-xs text-charcoal-muted">
        {primaryLabel
          ? `Main category: ${primaryLabel}. ${additionalIds.length}/${MEETUP_MAX_ADDITIONAL_INTERESTS} additional categories — tap more to add, tap the main one again to change it.`
          : "Pick the one category this Meetup is mostly about."}
      </p>
    </div>
  );
}

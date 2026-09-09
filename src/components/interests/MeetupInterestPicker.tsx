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
import { normalizeAdditionalInterestIds } from "@/lib/meetupInterestDraft";

/**
 * WO-124 — Meetup interest tagging.
 *
 * One required primary interest ("what is this Meetup about?") plus up to two
 * optional additional interests, all drawn from the same server catalogue used
 * for member profiles. Suggestions are hints only; the host always confirms.
 *
 * WO-149 — changing the main category of an existing (often older) Meetup is an
 * explicit, non-destructive action: the host opens "Change" and the next tap
 * replaces only the main category. Tapping the current main no longer clears it
 * together with every optional category, and a category can never be both main
 * and optional.
 */
export function MeetupInterestPicker({
  options,
  loading,
  primaryId: rawPrimaryId,
  additionalIds: rawAdditionalIds,
  onPrimaryChange,
  onAdditionalChange,
  suggestFrom,
  recovery = false,
}: {
  options: InterestOption[];
  loading?: boolean;
  primaryId: string | null;
  additionalIds: string[];
  onPrimaryChange: (id: string | null) => void;
  onAdditionalChange: (ids: string[]) => void;
  /** Free text (title/description) used to offer optional suggestions. */
  suggestFrom?: string;
  /**
   * WO-134 — true when this Meetup has no usable Main category yet (older
   * Meetup). Shows an explicit hint so the host knows the next tap sets it.
   */
  recovery?: boolean;
}) {
  const [query, setQuery] = useState("");
  /** WO-149 — true while the host is deliberately replacing the main category. */
  const [changingPrimary, setChangingPrimary] = useState(false);
  const groups = useMemo(
    () => groupInterests(filterInterests(options, query)),
    [options, query],
  );

  /**
   * DEF-134-02 — a stored Main category that is not selectable (retired or
   * legacy value) must behave as "not chosen", otherwise every tap would be
   * treated as an Additional category and the host could never set a Main one.
   */
  const primaryId = useMemo(
    () => (rawPrimaryId && options.some((o) => o.id === rawPrimaryId) ? rawPrimaryId : null),
    [rawPrimaryId, options],
  );

  /**
   * WO-149 — legacy rows can repeat the main category or the same id twice.
   * Normalising the *view* keeps main/optional unambiguous without rewriting
   * stored data.
   */
  const additionalIds = useMemo(
    () => normalizeAdditionalInterestIds(primaryId, rawAdditionalIds),
    [primaryId, rawAdditionalIds],
  );

  const suggestions = useMemo(() => {
    if (!suggestFrom) return [];
    return suggestInterestIds(options, suggestFrom).filter(
      (id) => id !== primaryId && !additionalIds.includes(id),
    );
  }, [options, suggestFrom, primaryId, additionalIds]);

  /** Choosing the main category never touches optional categories, except to
   * avoid the same id appearing twice. */
  function selectPrimary(id: string) {
    onPrimaryChange(id);
    onAdditionalChange(additionalIds.filter((x) => x !== id));
    setChangingPrimary(false);
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

  const choosingPrimary = primaryId === null || changingPrimary;

  function handleOptionTap(id: string) {
    if (choosingPrimary) {
      selectPrimary(id);
      return;
    }
    if (id === primaryId) {
      // Never destructive: asks the host to pick the replacement instead.
      setChangingPrimary(true);
      return;
    }
    toggleAdditional(id);
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
      {recovery && !primaryId && (
        <div
          role="status"
          className="mb-3 rounded-control border border-warning/50 bg-warning/10 p-3 text-xs text-charcoal"
        >
          <span className="block font-semibold">Main category needs to be set</span>
          This Meetup was created before categories were updated. Tap any category below to
          make it the Main category — the next taps add optional extras.
        </div>
      )}

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
                onClick={() => (choosingPrimary ? selectPrimary(id) : toggleAdditional(id))}
                className="min-h-11 px-3.5 py-2 rounded-full text-sm font-medium border border-dashed border-primary/60 text-primary bg-card hover:bg-accent/60 transition"
              >
                + {labelForId(options, id)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm font-semibold text-charcoal">
          Main category <span className="text-primary">*</span>
        </p>
        {primaryLabel && (
          <>
            <span className="text-sm text-charcoal-muted">{primaryLabel}</span>
            <button
              type="button"
              onClick={() => setChangingPrimary((v) => !v)}
              className="min-h-11 px-2 text-sm font-semibold text-primary underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-ring rounded-control"
            >
              {changingPrimary ? "Keep current main category" : "Change main category"}
            </button>
          </>
        )}
      </div>

      {changingPrimary && primaryLabel && (
        <div
          role="status"
          className="mb-3 rounded-control border border-primary/40 bg-accent/50 p-3 text-xs text-charcoal"
        >
          Tap a category to make it the new main category. Your optional categories stay as
          they are.
        </div>
      )}

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
                const blocked =
                  !choosingPrimary && !isPrimary && !isAdditional && atAdditionalMax;
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
                    onClick={() => handleOptionTap(o.id)}
                    disabled={blocked}
                    className={cn(
                      "min-h-11 px-3.5 py-2 rounded-full text-sm font-medium border transition active:scale-[0.97]",
                      isPrimary
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : isAdditional
                          ? "bg-accent text-charcoal border-primary/50"
                          : "bg-card text-charcoal border-border hover:bg-accent/60",
                      blocked && "opacity-40 cursor-not-allowed",
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
          ? changingPrimary
            ? `Main category: ${primaryLabel}. Tap a category to replace it.`
            : `Main category: ${primaryLabel}. ${additionalIds.length}/${MEETUP_MAX_ADDITIONAL_INTERESTS} additional categories — tap more to add, or use “Change main category”.`
          : "Pick the one category this Meetup is mostly about."}
      </p>
    </div>
  );
}

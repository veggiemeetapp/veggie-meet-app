import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEETUP_MAX_ADDITIONAL_INTERESTS, resolveMeetupTagIds } from "@/lib/interests";
import { fetchInterestLabels } from "@/lib/interestLabels";

/**
 * WO-125 — member-facing display of a Meetup's shared-taxonomy interest tags.
 *
 * Read-only presentation of data WO-124 already stores and authorises. Labels
 * come from `public.interest_catalogue` (including retired-but-resolvable rows,
 * so historical Meetups stay readable) — never from raw ids. Unknown, null,
 * malformed and duplicate values are dropped, and when nothing resolves the
 * whole section is omitted rather than rendering an empty heading.
 */
export function MeetupInterestTags({
  primaryInterestId,
  additionalInterestIds,
}: {
  primaryInterestId?: string | null;
  additionalInterestIds?: string[] | null;
}) {
  const { primaryId, additionalIds } = useMemo(
    () => resolveMeetupTagIds(primaryInterestId, additionalInterestIds),
    [primaryInterestId, additionalInterestIds],
  );

  const ids = useMemo(
    () => (primaryId ? [primaryId, ...additionalIds] : additionalIds),
    [primaryId, additionalIds],
  );

  const labels = useQuery({
    queryKey: ["interest-labels", ids],
    enabled: ids.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: () => fetchInterestLabels(ids),
  });

  if (!ids.length) return null;

  const map = labels.data;
  // Loading / error must not flash raw ids or an empty heading.
  if (!map) return null;

  const primaryLabel = primaryId ? map[primaryId] : undefined;
  const additionalLabels = additionalIds
    .map((id) => map[id])
    .filter((l): l is string => !!l)
    .slice(0, MEETUP_MAX_ADDITIONAL_INTERESTS);

  if (!primaryLabel && additionalLabels.length === 0) return null;

  return (
    <section aria-labelledby="meetup-interests-heading">
      <h2
        id="meetup-interests-heading"
        className="text-lg font-semibold text-charcoal"
      >
        What this Meetup is about
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {primaryLabel && (
          <li
            className="inline-flex max-w-full items-center rounded-full bg-soft-green px-3.5 py-1.5 text-sm font-semibold text-primary break-words"
          >
            <span className="sr-only">Main interest: </span>
            {primaryLabel}
          </li>
        )}
        {additionalLabels.map((label) => (
          <li
            key={label}
            className="inline-flex max-w-full items-center rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-charcoal break-words"
          >
            <span className="sr-only">Also about: </span>
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

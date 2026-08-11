import { Link } from "react-router-dom";
import { SearchX, Sprout } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";

/**
 * WO-095 §7: a zero-result search has distinct causes, and one generic message
 * for all of them reads as a broken app in a sparse market. `sparse` means the
 * catalogue itself is still thin (nothing to match against), which is a growth
 * state with a useful next step — not a failed query.
 */
interface Props {
  cityName: string | null;
  allCities: boolean;
  onExpand?: () => void;
  /** True when the searched catalogue is empty in scope, not just unmatched. */
  sparse?: boolean;
  scope?: "all" | "veggies" | "meetups" | "places";
}

export function SearchEmptyState({ cityName, allCities, onExpand, sparse, scope = "all" }: Props) {
  if (sparse) {
    const copy: Record<string, { title: string; description: string; to?: string; label?: string }> = {
      all: {
        title: "Still growing here",
        description: cityName
          ? `VeggieMeet is just getting started in ${cityName}. There isn’t much to search yet.`
          : "VeggieMeet is just getting started. There isn’t much to search yet.",
      },
      veggies: {
        title: "Veggies are still joining",
        description: "We’ll show people here as the community grows in your city.",
      },
      meetups: {
        title: "No Meetups yet",
        description: "Be the first to get something going in your city.",
        to: "/host",
        label: "Host a Meetup",
      },
      places: {
        title: "No verified places yet",
        description: "Suggest a fully vegan place you love and we’ll verify it.",
        to: "/community/places/suggest",
        label: "Suggest a place",
      },
    };
    const c = copy[scope];
    return (
      <EmptyState
        icon={<Sprout aria-hidden />}
        title={c.title}
        description={c.description}
        action={
          c.to && c.label ? (
            <Link
              to={c.to}
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              {c.label}
            </Link>
          ) : undefined
        }
      />
    );
  }

  const title = !allCities && cityName ? `No matches in ${cityName}` : "No matches";
  return (
    <EmptyState
      icon={<SearchX aria-hidden />}
      title={title}
      description={
        !allCities
          ? "Try a different spelling, or widen the search to every city."
          : "Try a different spelling or a shorter search."
      }
      action={
        !allCities && onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            Search all cities
          </button>
        ) : undefined
      }
    />
  );
}

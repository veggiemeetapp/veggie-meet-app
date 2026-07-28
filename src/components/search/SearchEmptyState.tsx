import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";

interface Props {
  cityName: string | null;
  allCities: boolean;
  onExpand?: () => void;
}

export function SearchEmptyState({ cityName, allCities, onExpand }: Props) {
  const title = allCities
    ? "No matches"
    : cityName
      ? `No matches in ${cityName}`
      : "No matches";
  return (
    <EmptyState
      icon={<SearchX className="w-6 h-6" aria-hidden />}
      title={title}
      description="Try another search or broaden your city filter."
      action={
        !allCities && onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium"
          >
            Search all cities
          </button>
        ) : undefined
      }
    />
  );
}

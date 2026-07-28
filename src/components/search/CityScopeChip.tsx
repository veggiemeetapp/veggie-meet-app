import { Globe2, MapPin } from "lucide-react";

interface Props {
  cityName: string | null;
  allCities: boolean;
  onToggle: () => void;
}

export function CityScopeChip({ cityName, allCities, onToggle }: Props) {
  const label = allCities ? "All cities" : cityName ?? "No city";
  const Icon = allCities ? Globe2 : MapPin;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-muted/60 border border-border/60 text-xs font-medium text-charcoal hover:bg-muted transition-colors"
      aria-label={
        allCities
          ? "Search scope: all cities. Tap to limit to your selected city."
          : `Search scope: ${cityName ?? "no city"}. Tap to search all cities.`
      }
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {label}
    </button>
  );
}

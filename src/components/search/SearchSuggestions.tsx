import { Sparkles } from "lucide-react";

interface Props {
  cityName: string | null;
  onPick: (term: string) => void;
}

const BASE = [
  "Coffee meetups",
  "Vegan restaurants",
  "Meetups this weekend",
  "Cooking",
  "Hiking",
  "Brunch",
];

export function SearchSuggestions({ cityName, onPick }: Props) {
  return (
    <section aria-labelledby="search-suggested-heading" className="px-5">
      <h2
        id="search-suggested-heading"
        className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted mb-2 flex items-center gap-1.5"
      >
        <Sparkles className="w-3 h-3" aria-hidden />
        Suggested {cityName && <span className="normal-case tracking-normal font-normal text-charcoal-muted">in {cityName}</span>}
      </h2>
      <div className="flex flex-wrap gap-2">
        {BASE.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="h-9 px-3 rounded-full bg-muted/60 border border-border/60 text-xs text-charcoal hover:bg-muted transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}

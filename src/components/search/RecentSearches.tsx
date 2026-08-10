import { Clock, X } from "lucide-react";

interface Props {
  items: string[];
  onPick: (term: string) => void;
  onRemove: (term: string) => void;
  onClear: () => void;
}

export function RecentSearches({ items, onPick, onRemove, onClear }: Props) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="search-recent-heading" className="px-5">
      <div className="flex items-center justify-between mb-2">
        <h2
          id="search-recent-heading"
          className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted flex items-center gap-1.5"
        >
          <Clock className="w-3 h-3" aria-hidden />
          Recent
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-charcoal-muted hover:text-primary"
        >
          Clear all
        </button>
      </div>
      <ul className="space-y-1">
        {items.map((term) => (
          <li key={term} className="flex items-center">
            <button
              type="button"
              onClick={() => onPick(term)}
              className="flex-1 text-left h-9 px-3 rounded-control text-sm text-charcoal hover:bg-muted/50"
            >
              {term}
            </button>
            <button
              type="button"
              onClick={() => onRemove(term)}
              aria-label={`Remove ${term} from recent searches`}
              className="w-9 h-9 rounded-full inline-flex items-center justify-center hover:bg-muted/50 text-charcoal-muted"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

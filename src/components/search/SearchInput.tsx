import { Search, X } from "lucide-react";
import { forwardRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, onClear, autoFocus, placeholder = "Search Veggies, Meetups, Places" }, ref) => (
    <div className="flex items-center gap-2 h-11 rounded-2xl bg-muted/60 border border-border/60 px-3 focus-within:ring-2 focus-within:ring-primary/40">
      <Search className="w-4 h-4 text-charcoal-muted shrink-0" aria-hidden />
      <input
        ref={ref}
        type="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search"
        className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-charcoal-muted"
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-background/60"
        >
          <X className="w-4 h-4 text-charcoal-muted" aria-hidden />
        </button>
      )}
    </div>
  ),
);
SearchInput.displayName = "SearchInput";

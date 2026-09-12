import { memberSafeMessage } from "@/lib/errors";
import { useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useActiveCities,
  useLocationContext,
  useSetSelectedCity,
} from "@/hooks/useLocation";

interface CitySelectorProps {
  /** Visual variant. "chip" is compact for headers; "block" is full-width. */
  variant?: "chip" | "block";
  className?: string;
  /** Overrides the button label; defaults to Selected City name. */
  placeholder?: string;
  /**
   * When provided, the selector delegates city selection to the caller instead
   * of writing Selected City. Use this for Home City edits or Host Meetup
   * location picker. Value shows the currently highlighted city id.
   */
  onSelect?: (cityId: string, cityName: string) => void | Promise<void>;
  value?: string | null;
  /** Custom trigger label when `onSelect` is provided. */
  triggerLabel?: string;
  /** Custom popover title. */
  title?: string;
}

/**
 * The single reusable City Selector for VeggieMeet.
 *
 * Default mode reads/writes Selected City via canonical RPCs.
 * When `onSelect` is provided, the caller owns the mutation (e.g. Home City).
 */
export function CitySelector({
  variant = "chip",
  className,
  placeholder = "Choose city",
  onSelect,
  value,
  triggerLabel,
  title,
}: CitySelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const citiesQuery = useActiveCities();
  const contextQuery = useLocationContext();
  const setSelected = useSetSelectedCity();

  const contextSelected = contextQuery.data?.selected_city ?? null;
  const home = contextQuery.data?.home_city ?? null;
  const selected = onSelect
    ? cities().find((c) => c.id === value) ?? null
    : contextSelected;

  function cities() {
    return citiesQuery.data ?? [];
  }
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = citiesQuery.data ?? [];
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || c.country_code.toLowerCase().includes(q),
    );
  }, [citiesQuery.data, query]);

  async function choose(id: string, name: string) {
    try {
      if (onSelect) {
        await onSelect(id, name);
      } else {
        await setSelected.mutateAsync(id);
        toast.success(`Exploring ${name}`);
      }
      setOpen(false);
      setQuery("");
    } catch (e) {
      toast.error("Couldn't update your city", {
        description: memberSafeMessage(e),
      });
    }
  }

  const label = triggerLabel ?? selected?.name ?? placeholder;
  const showHomeShortcut = !onSelect && home && (!selected || selected.id !== home.id);
  const busy = onSelect ? false : setSelected.isPending;

  const trigger =
    variant === "chip" ? (
      <button
        type="button"
        aria-label={triggerLabel ?? (selected ? `Selected city: ${selected.name}. Change city.` : "Choose city")}
        className={cn(
          // WO-095B DEF-095A-05: `max-w-full` + `min-w-0` keep the chip inside
          // its container at enlarged text; the city name truncates instead of
          // widening the header. Height is a minimum so the label is never cut.
          "inline-flex items-center gap-1 px-3 rounded-full border border-border bg-card text-xs font-medium text-charcoal hover:bg-accent transition-colors min-h-11 min-w-11 max-w-full",
          className,
        )}
      >
        <MapPin className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
        <span className="truncate min-w-0">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-charcoal-muted shrink-0" aria-hidden />
      </button>
    ) : (
      <button
        type="button"
        aria-label={triggerLabel ?? (selected ? `Selected city: ${selected.name}. Change city.` : "Choose city")}
        className={cn(
          "w-full flex items-center justify-between h-12 rounded-control border border-border bg-card px-4 text-sm font-medium text-charcoal hover:bg-accent transition-colors",
          className,
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-primary shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-charcoal-muted" aria-hidden />
      </button>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* WO-085A DEF-085A-01 (WCAG 4.1.2): the trigger used to be a <span>
          wrapper, so Radix put aria-haspopup/aria-expanded on a non-interactive
          element. The real <button> is now the trigger itself. */}
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={variant === "chip" ? "start" : "end"}
        sideOffset={8}
        className="w-72 p-0 rounded-card overflow-hidden"
        style={
          variant === "chip"
            ? {
                // Header chips sit on the page gutter. Match the popover to the
                // app's content width so it stays centered inside the screen.
                width:
                  "calc(min(100vw, var(--phone-max-width)) - (2 * var(--page-gutter)))",
              }
            : undefined
        }
      >
        {title && (
          <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-muted">
            {title}
          </div>
        )}
        <div className="px-3 pt-3 pb-2 border-b border-border/60">
          <label className="sr-only" htmlFor="city-selector-search">
            Search cities
          </label>
          <div className="flex items-center gap-2 h-10 px-3 rounded-control bg-muted">
            <Search className="w-4 h-4 text-charcoal-muted" aria-hidden />
            <input
              id="city-selector-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cities"
              className="flex-1 bg-transparent text-sm text-charcoal placeholder:text-charcoal-muted focus:outline-none"
            />
          </div>
        </div>

        {showHomeShortcut && (
          <button
            type="button"
            onClick={() => choose(home!.id, home!.name)}
            disabled={busy}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-primary font-semibold hover:bg-accent/40 disabled:opacity-60"
          >
            Use Home City · {home!.name}
          </button>
        )}

        <div className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="Cities">
          {citiesQuery.isPending ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-charcoal-muted">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              Loading cities…
            </div>
          ) : citiesQuery.isError ? (
            <div className="px-4 py-6 text-sm text-destructive">
              Couldn't load cities. Please try again.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-sm text-charcoal-muted">
              No cities match "{query}".
            </div>
          ) : (
            filtered.map((c) => {
              const isSelected = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => choose(c.id, c.name)}
                  disabled={busy}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-accent/40 disabled:opacity-60",
                    isSelected && "bg-accent/30",
                  )}
                >
                  <span className="min-w-0 truncate text-charcoal">
                    {c.name}
                    <span className="ml-1.5 text-[10px] text-charcoal-muted uppercase">
                      {c.country_code}
                    </span>
                  </span>
                  {isSelected && <Check className="w-4 h-4 text-primary" aria-hidden />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Empty state shown when the signed-in user has no Selected City yet.
 * Not automatic — user opens the selector explicitly.
 */
export function NoCityState({ onChoose }: { onChoose: () => void }) {
  const contextQuery = useLocationContext();
  const setSelected = useSetSelectedCity();
  const home = contextQuery.data?.home_city ?? null;

  async function useHome() {
    if (!home) return;
    try {
      await setSelected.mutateAsync(home.id);
      toast.success(`Exploring ${home.name}`);
    } catch (e) {
      toast.error("Couldn't set your city", {
        description: memberSafeMessage(e),
      });
    }
  }

  return (
    <div className="mx-5 mt-4 rounded-card border border-dashed border-border p-5 text-center">
      <MapPin className="w-6 h-6 mx-auto text-primary" aria-hidden />
      <h2 className="mt-2 text-base font-semibold text-charcoal">
        Choose a city to explore.
      </h2>
      <p className="mt-1 text-sm text-charcoal-muted">
        Your selected city shapes the Veggies, Places, and Meetups you see.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onChoose}
          className="w-full h-11 rounded-control bg-primary text-primary-foreground font-semibold hover:opacity-95"
        >
          Choose City
        </button>
        {home && (
          <button
            type="button"
            onClick={useHome}
            disabled={setSelected.isPending}
            className="w-full h-11 rounded-control border border-border bg-card text-sm font-semibold text-charcoal hover:bg-accent/40 disabled:opacity-60"
          >
            Use Home City · {home.name}
          </button>
        )}
      </div>
    </div>
  );
}

import type { ResultTab } from "@/screens/Search";

const tabs: { id: ResultTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "veggies", label: "Veggies" },
  { id: "meetups", label: "Meetups" },
  { id: "places", label: "Places" },
];

interface Props {
  value: ResultTab;
  onChange: (v: ResultTab) => void;
}

export function SearchTabs({ value, onChange }: Props) {
  return (
    // WO-095B DEF-095A-06: the tab rail scrolls internally as a last resort at
    // very large text sizes, so the page itself never gains horizontal scroll.
    <div role="tablist" aria-label="Search result types" className="rail flex gap-1 overflow-x-auto px-1 py-1 rounded-full bg-muted/60 border border-border/60">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={
              // DEF-092A-07: without min-w-0 the labels set a floor width and the
              // last tab spilled ~2px past the rail, producing a hairline
              // horizontal scroll at 430px.
              "flex-1 min-w-0 h-8 px-2.5 rounded-full text-xs font-medium truncate transition-colors " +
              (active
                ? "bg-background text-charcoal shadow-sm"
                : "text-charcoal-muted hover:text-charcoal")
            }

          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

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
    <div role="tablist" aria-label="Search result types" className="flex gap-1 px-1 py-1 rounded-full bg-muted/60 border border-border/60">
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
              "flex-1 h-8 px-3 rounded-full text-xs font-medium transition-colors " +
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

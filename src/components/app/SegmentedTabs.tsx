import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedTabItem<K extends string> {
  key: K;
  label: string;
  /** Count shown after the label (e.g. "Stickers 9"). */
  count?: number;
  /** Small dot after the label: something new to look at in this tab. */
  dot?: boolean;
}

/**
 * Pill tab switcher with a sliding highlight. The highlight is one absolutely
 * positioned element that moves to the active button (measured, so labels
 * can have different widths), instead of each button repainting its own
 * background. Press feedback and the slide respect prefers-reduced-motion via
 * the global stylesheet rule that zeroes transitions.
 */
export function SegmentedTabs<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: readonly SegmentedTabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLButtonElement>(`[data-tab-key="${CSS.escape(value)}"]`);
      if (!el) return;
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(list);
    return () => ro?.disconnect();
  }, [value, items.length]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative flex p-1 bg-muted rounded-full", className)}
    >
      {indicator && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-full bg-card shadow-sm transition-[transform,width] duration-250 ease-out"
          style={{ width: indicator.width, transform: `translateX(${indicator.left - 4}px)`, left: 4 }}
        />
      )}
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-tab-key={it.key}
            onClick={() => onChange(it.key)}
            className={cn(
              "relative z-10 flex-1 h-9 rounded-full text-sm font-semibold transition-[color,transform] duration-150 active:scale-[0.97]",
              active ? "text-charcoal" : "text-charcoal-muted hover:text-charcoal",
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={cn("ml-1 tabular-nums font-medium", active ? "text-charcoal-muted" : "opacity-70")}>
                {it.count}
              </span>
            )}
            {it.dot && (
              <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle" aria-label="new" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedTabs;

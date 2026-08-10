import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: ReactNode;
  action?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}

/**
 * WO-092 section rhythm: 24px above a section heading, 12px down to its cards.
 * Horizontal padding matches the single page gutter.
 */
export function SectionHeader({ title, subtitle, action, className }: Props) {
  return (
    <div className={cn("flex items-end justify-between gap-3 page-x mt-6 mb-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold text-charcoal tracking-tight leading-snug">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[13px] text-charcoal-muted mt-0.5 leading-snug">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

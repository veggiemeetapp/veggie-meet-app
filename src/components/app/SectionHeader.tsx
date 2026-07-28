import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: ReactNode;
  action?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, subtitle, action, className }: Props) {
  return (
    <div className={cn("flex items-end justify-between gap-3 px-5 mt-6 mb-3", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-charcoal tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-charcoal-muted mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

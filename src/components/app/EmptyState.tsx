import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center text-center px-6 py-12", className)}>
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-soft-green text-primary flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      {/* WO-085A DEF-085A-04 (WCAG 1.3.1): h2 keeps the empty-state title
          one level below each surface h1 instead of skipping a level. */}
      <h2 className="text-base font-semibold text-charcoal">{title}</h2>
      {description && (
        <p className="text-sm text-charcoal-muted mt-1 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

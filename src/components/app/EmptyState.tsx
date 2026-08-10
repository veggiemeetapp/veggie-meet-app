import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * WO-092 empty-state treatment: one icon scale (48px tinted tile, 20px glyph),
 * one heading level, relaxed supporting copy, action last.
 */
export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center text-center page-x py-10", className)}>
      {icon && (
        <div className="w-12 h-12 rounded-control bg-soft-green text-primary flex items-center justify-center mb-4 [&_svg]:w-5 [&_svg]:h-5">
          {icon}
        </div>
      )}
      {/* WO-085A DEF-085A-04 (WCAG 1.3.1): h2 keeps the empty-state title
          one level below each surface h1 instead of skipping a level. */}
      <h2 className="text-base font-semibold text-charcoal">{title}</h2>
      {description && (
        <p className="text-sm text-charcoal-muted copy mt-1.5 max-w-[17rem]">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

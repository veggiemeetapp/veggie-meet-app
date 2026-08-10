import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  left?: ReactNode;
  className?: string;
}

export function AppHeader({ title, subtitle, right, left, className }: AppHeaderProps) {
  return (
    <header
      className={cn(
        "safe-top sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border",
        className
      )}
    >
      {/* WO-092 top bar: one gutter, one 56px min height, back control at the
          left edge, actions grouped right, title never competing with them. */}
      <div className="flex items-center justify-between gap-2 page-x py-2.5 min-h-[3.5rem]">
        <div className="flex items-center gap-2 min-w-0">
          {left}
          <div className="min-w-0">
            {title && (
              <h1 className="text-[19px] font-semibold text-charcoal leading-tight truncate">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="text-[13px] text-charcoal-muted truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {right && <div className="flex items-center gap-1">{right}</div>}
      </div>
    </header>
  );
}


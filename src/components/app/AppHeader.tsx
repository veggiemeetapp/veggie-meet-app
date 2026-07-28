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
        "safe-top sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border/60",
        className
      )}
    >
      <div className="flex items-center justify-between px-5 pt-3 pb-3 min-h-[3.5rem]">
        <div className="flex items-center gap-3 min-w-0">
          {left}
          <div className="min-w-0">
            {title && (
              <h1 className="text-xl font-semibold text-charcoal leading-tight truncate">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="text-sm text-charcoal-muted truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}

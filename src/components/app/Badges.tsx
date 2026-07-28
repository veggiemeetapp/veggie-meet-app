import { Sparkles, Leaf } from "lucide-react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  className?: string;
  children?: React.ReactNode;
}

export function HostBadge({ className, children = "Host" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-soft-green text-primary",
        className
      )}
    >
      <Leaf className="w-3 h-3" />
      {children}
    </span>
  );
}

export function ActiveHostBadge({ className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-host-badge/15 text-host-badge",
        className
      )}
    >
      <Sparkles className="w-3 h-3" />
      Active Host
    </span>
  );
}

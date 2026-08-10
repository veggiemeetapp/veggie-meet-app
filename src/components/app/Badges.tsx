import { Sparkles, Leaf, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * WO-092 badge system. One geometry for every status pill:
 * pill radius, 8px horizontal padding, 11px semibold text, 12px icon,
 * 4px icon gap. Only the tone changes, and every tone pairs colour with an
 * icon or word so meaning never rests on colour alone.
 */
const badgeBase =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-5 whitespace-nowrap";

export type StatusTone = "positive" | "neutral" | "attention" | "critical" | "brand";

const toneMap: Record<StatusTone, string> = {
  positive: "bg-soft-green text-primary",
  neutral: "bg-muted text-charcoal-muted",
  attention: "bg-warning-soft text-warning",
  critical: "bg-destructive/10 text-destructive",
  brand: "bg-host-badge/15 text-host-badge",
};

export function StatusBadge({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: StatusTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeBase, toneMap[tone], className)}>
      {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function HostBadge({ className, children = "Host" }: BadgeProps) {
  return (
    <span className={cn(badgeBase, toneMap.positive, className)}>
      <Leaf className="w-3 h-3 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

export function ActiveHostBadge({ className }: BadgeProps) {
  return (
    <span className={cn(badgeBase, toneMap.brand, className)}>
      <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
      Active Host
    </span>
  );
}

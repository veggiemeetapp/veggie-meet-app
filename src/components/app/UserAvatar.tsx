import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

interface UserAvatarProps {
  name: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  ring?: boolean;
}

const sizeMap = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-base",
  xl: "w-20 h-20 text-lg",
};

export function UserAvatar({ name, src, size = "md", className, ring }: UserAvatarProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-accent text-accent-foreground font-semibold overflow-hidden shrink-0",
        sizeMap[size],
        ring && "ring-2 ring-background",
        className
      )}
      aria-label={name}
    >
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}

interface AvatarGroupUser {
  displayName: string;
  avatarUrl?: string;
}

interface AvatarGroupProps {
  users: AvatarGroupUser[];
  max?: number;
  size?: "xs" | "sm" | "md";
  totalCount?: number;
}

export function AvatarGroup({ users, max = 4, size = "sm", totalCount }: AvatarGroupProps) {
  const shown = users.slice(0, max);
  const total = totalCount ?? users.length;
  const extra = total - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((u, i) => (
          <UserAvatar key={i} name={u.displayName} src={u.avatarUrl} size={size} ring />
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-2 text-xs font-medium text-charcoal-muted">
          +{extra}
        </span>
      )}
    </div>
  );
}

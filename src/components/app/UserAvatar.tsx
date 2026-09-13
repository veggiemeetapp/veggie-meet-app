import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveAvatar } from "@/lib/avatar";

interface UserAvatarProps {
  name: string;
  src?: string | null;
  /**
   * WO-143: stable identifier (profile id preferred) used to pick this member's
   * platform cartoon avatar when no personal photo is stored. Falls back to the
   * display name so every surface stays deterministic.
   */
  seed?: string | null;
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

export function UserAvatar({ name, src, seed, size = "md", className, ring }: UserAvatarProps) {
  // WO-086 DEF-086-04: avatars are the most repeated image in the product.
  // They decode off the main thread and defer offscreen fetches.
  //
  // WO-143: there is no initial-letter fallback any more. Missing, empty or
  // invalid avatar values resolve to the member's stable VeggieMeet platform
  // cartoon avatar; if a personal photo fails to load we swap to that same
  // platform avatar once (no retry storm).
  const resolved = resolveAvatar(src, seed || name);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(resolved.isPlatform);
  useEffect(() => {
    setFailed(false);
    setLoaded(resolved.isPlatform);
  }, [src, resolved.isPlatform]);
  const showSrc = failed ? resolved.fallbackSrc : resolved.src;
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
      {!resolved.isPlatform && !failed ? (
        <img
          src={resolved.fallbackSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : null}
      <img
        src={showSrc}
        alt={name}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
          setLoaded(true);
        }}
        className={cn(
          "relative w-full h-full object-cover transition-opacity duration-200 ease-out motion-reduce:transition-none",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

interface AvatarGroupUser {
  displayName: string;
  avatarUrl?: string | null;
  id?: string | null;
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
          <UserAvatar
            key={u.id ?? i}
            name={u.displayName}
            src={u.avatarUrl}
            seed={u.id ?? u.displayName}
            size={size}
            ring
          />
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


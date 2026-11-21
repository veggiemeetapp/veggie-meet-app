import { categoryEmoji, stickerHue, STICKER_MAX_LEVEL } from "@/lib/collection";
import { cn } from "@/lib/utils";

/**
 * A generated place sticker. Artwork is deterministic (hue from the place id,
 * emoji from the category) so no image assets are needed on web or iOS.
 * The rim shows the level the way STIKKA's rim shows visit count:
 *  level 0 — grey, dashed (not collected yet)
 *  level 1 — plain rim
 *  level 2 — double rim
 *  level 3 — gold rim with a star
 */
export function PlaceSticker({
  placeId,
  name,
  category,
  level,
  size = 96,
  className,
  muted = false,
}: {
  placeId: string;
  name: string;
  category: string | null | undefined;
  level: number;
  size?: number;
  className?: string;
  /** Render as "not collected yet". */
  muted?: boolean;
}) {
  const hue = stickerHue(placeId);
  const collected = !muted && level > 0;
  const bg = collected ? `hsl(${hue} 55% 88%)` : "hsl(var(--muted))";
  const ink = collected ? `hsl(${hue} 45% 32%)` : "hsl(var(--charcoal-muted))";
  const rim =
    !collected
      ? "hsl(var(--border-strong, var(--border)))"
      : level >= STICKER_MAX_LEVEL
        ? "hsl(42 85% 52%)"
        : `hsl(${hue} 50% 48%)`;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const emoji = categoryEmoji(category);
  const fontEmoji = Math.round(size * 0.32);
  const fontInitials = Math.round(size * 0.14);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${name} sticker, level ${level}`}
      className={cn("shrink-0 select-none", !collected && "opacity-70", className)}
    >
      <defs>
        <filter id={`sh-${placeId}`} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodOpacity="0.18" />
        </filter>
      </defs>
      {/* white paper edge like a peeled sticker */}
      <circle cx="50" cy="50" r="48" fill="hsl(var(--card))" filter={`url(#sh-${placeId})`} />
      <circle
        cx="50"
        cy="50"
        r="44"
        fill={bg}
        stroke={rim}
        strokeWidth={level >= 2 ? 3 : 2}
        strokeDasharray={!collected ? "4 3" : undefined}
      />
      {collected && level >= 2 && (
        <circle cx="50" cy="50" r="39" fill="none" stroke={rim} strokeWidth="1.2" opacity="0.7" />
      )}
      <text
        x="50"
        y="48"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontEmoji}
        style={{ filter: collected ? undefined : "grayscale(1)" }}
      >
        {emoji}
      </text>
      <text
        x="50"
        y="74"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontInitials}
        fontWeight={700}
        fill={ink}
        style={{ letterSpacing: 1 }}
      >
        {initials || "·"}
      </text>
      {collected && level >= STICKER_MAX_LEVEL && (
        <text x="78" y="24" textAnchor="middle" dominantBaseline="central" fontSize="16">
          ⭐
        </text>
      )}
    </svg>
  );
}

export default PlaceSticker;

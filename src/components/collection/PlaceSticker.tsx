import { createContext, useContext, useId, useMemo, type ReactNode } from "react";
import { usePlaceCoverUrl, usePlaceCoverUrls } from "@/hooks/usePlacePhotos";
import { categoryEmoji, stickerHue, STICKER_MAX_LEVEL } from "@/lib/collection";
import { samplePhotoDataUrl } from "@/lib/collectionMock";
import { useTestMode } from "@/lib/testMode";
import { cn } from "@/lib/utils";

/**
 * Place sticker, v2 (2026-11-22, after owner feedback that initials on a
 * random colour "looked like a default avatar").
 *
 * Die-cut round sticker: white paper edge, the place's own cover photo
 * clipped inside (the same owner-managed photo the map and place page use),
 * the place name curved along the bottom rim, a small category badge, and a
 * rim that shows the level:
 *   level 0  grey, dashed, photo desaturated   (not collected yet)
 *   level 1  thin white rim
 *   level 2  rim in the place's colour
 *   level 3  gold rim + star                    (local legend)
 * Places without a photo keep a tinted disc with the category emoji, so no
 * sticker is ever blank.
 *
 * Photos: screens that show many stickers wrap them in <PlaceCoverProvider>
 * (one batched fetch); a lone sticker fetches its own cover.
 */

const PlaceCoverContext = createContext<Record<string, string> | null>(null);

export function PlaceCoverProvider({ placeIds, children }: { placeIds: string[]; children: ReactNode }) {
  const test = useTestMode();
  const q = usePlaceCoverUrls(test ? [] : placeIds);
  const value = useMemo(() => q.data ?? {}, [q.data]);
  return <PlaceCoverContext.Provider value={value}>{children}</PlaceCoverContext.Provider>;
}

const MOCK_PREFIX = "00000000-0000-4000-8000-";

/** Cover URL for one sticker: batched context first, else a single fetch; sample art in Test mode. */
function useStickerCover(placeId: string, name: string): string | null {
  const test = useTestMode();
  const ctx = useContext(PlaceCoverContext);
  const needsOwnFetch = !test && !ctx;
  const single = usePlaceCoverUrl(needsOwnFetch ? placeId : undefined);
  if (test) return placeId.startsWith(MOCK_PREFIX) ? samplePhotoDataUrl(placeId, name, 320, 320) : null;
  if (ctx) return ctx[placeId] ?? null;
  return single ?? null;
}

/** Fit the name on the bottom arc. */
function arcLabel(name: string, size: number): string {
  const max = size >= 80 ? 22 : size >= 60 ? 18 : size >= 44 ? 14 : 0;
  if (max === 0) return "";
  const clean = name.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

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
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const cover = useStickerCover(placeId, name);
  const hue = stickerHue(placeId);
  const collected = !muted && level > 0;
  const emoji = categoryEmoji(category);
  const label = arcLabel(name, size);

  const tint = collected ? `hsl(${hue} 55% 86%)` : "hsl(var(--muted))";
  const rim =
    !collected
      ? "hsl(var(--border-strong))"
      : level >= STICKER_MAX_LEVEL
        ? "hsl(42 88% 50%)"
        : level >= 2
          ? `hsl(${hue} 55% 46%)`
          : "hsl(0 0% 100%)";
  const rimWidth = !collected ? 2 : level >= 2 ? 3.2 : 2.2;

  const clipId = `clip-${uid}`;
  const arcId = `arc-${uid}`;
  const shadowId = `sh-${uid}`;
  const greyId = `grey-${uid}`;
  const bandId = `band-${uid}`;
  const ink = collected ? `hsl(${hue} 45% 28%)` : "hsl(var(--charcoal-muted))";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${name} sticker, level ${level}`}
      className={cn("shrink-0 select-none", !collected && "opacity-80", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="50" cy="50" r="41" />
        </clipPath>
        {/* Bottom arc, left to right, for the curved name. */}
        <path id={arcId} d="M 14.5 58 A 36 36 0 0 0 85.5 58" fill="none" />
        <filter id={shadowId} x="-12%" y="-12%" width="124%" height="124%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.6" floodOpacity="0.22" />
        </filter>
        <filter id={greyId}>
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
        <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(20,24,20,0)" />
          <stop offset="0.45" stopColor="rgba(20,24,20,0.38)" />
          <stop offset="1" stopColor="rgba(20,24,20,0.6)" />
        </linearGradient>
      </defs>

      {/* Paper edge */}
      <circle cx="50" cy="50" r="48.5" fill="hsl(var(--card))" filter={`url(#${shadowId})`} />

      {/* Photo or tinted emoji disc */}
      <circle cx="50" cy="50" r="41" fill={tint} />
      {cover ? (
        <image
          href={cover}
          x="9"
          y="9"
          width="82"
          height="82"
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
          filter={collected ? undefined : `url(#${greyId})`}
        />
      ) : (
        <text
          x="50"
          y={label ? 46 : 50}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={label ? 30 : 36}
          style={{ filter: collected ? undefined : "grayscale(1)" }}
        >
          {emoji}
        </text>
      )}

      {/* Soft bottom shade so the curved name reads on any photo */}
      {label && cover && (
        <path d="M 9 54 A 41 41 0 0 0 91 54 Z" clipPath={`url(#${clipId})`} fill={`url(#${bandId})`} />
      )}

      {/* Level rim */}
      <circle
        cx="50"
        cy="50"
        r="43.5"
        fill="none"
        stroke={rim}
        strokeWidth={rimWidth}
        strokeDasharray={!collected ? "4 3" : undefined}
      />
      {collected && level >= STICKER_MAX_LEVEL && (
        <circle cx="50" cy="50" r="39.5" fill="none" stroke="hsl(42 88% 50%)" strokeWidth="0.9" opacity="0.8" />
      )}

      {/* Curved name */}
      {label && (
        <text
          fontSize="8.2"
          fontWeight={700}
          fill={cover ? "#fff" : ink}
          stroke={cover ? "rgba(0,0,0,0.35)" : "none"}
          strokeWidth="0.6"
          paintOrder="stroke"
          style={{ letterSpacing: 0.3, fontFamily: "inherit" }}
        >
          <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
            {label}
          </textPath>
        </text>
      )}

      {/* Category badge (only when there's a photo; the emoji disc already says it) */}
      {cover && (
        <g>
          <circle cx="20" cy="22" r="9.5" fill="hsl(var(--card))" stroke="rgba(0,0,0,0.08)" strokeWidth="0.8" />
          <text x="20" y="22.5" textAnchor="middle" dominantBaseline="central" fontSize="10.5">
            {emoji}
          </text>
        </g>
      )}

      {collected && level >= STICKER_MAX_LEVEL && (
        <text x="80" y="20" textAnchor="middle" dominantBaseline="central" fontSize="15">
          ⭐
        </text>
      )}
    </svg>
  );
}

export default PlaceSticker;

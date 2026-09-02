import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PLATFORM_AVATARS, platformAvatarToken } from "@/lib/avatar";

/**
 * WO-143C (addition) — accessible gallery of the eight founder-approved
 * VeggieMeet platform avatars.
 *
 * Behaviour contract:
 *  - Rendered as a `radiogroup` with roving tabindex; Arrow/Home/End move focus
 *    and select, Space/Enter select the focused avatar.
 *  - The currently assigned or selected avatar is visibly ringed, labelled
 *    "current", and exposed via `aria-checked`.
 *  - Selection changes are announced through a polite live region.
 *  - No gendered labels, no "random" copy, no reroll-only interaction: every
 *    avatar is directly selectable.
 */
export interface PlatformAvatarGalleryProps {
  /** Currently stored avatar value (token or uploaded URL). */
  value: string | null;
  /** The member's deterministic assigned token, shown as "current" when nothing else is selected. */
  assignedToken: string;
  onSelect: (token: string) => void;
  className?: string;
}

export function PlatformAvatarGallery({
  value,
  assignedToken,
  onSelect,
  className,
}: PlatformAvatarGalleryProps) {
  const tokens = PLATFORM_AVATARS.map((_, i) => platformAvatarToken(i + 1));
  const current = value && tokens.includes(value) ? value : assignedToken;
  const currentIndex = Math.max(0, tokens.indexOf(current));
  const [focusIndex, setFocusIndex] = useState(currentIndex);
  const [announcement, setAnnouncement] = useState("");
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    refs.current[focusIndex]?.focus();
  }, [focusIndex]);

  function select(index: number) {
    const token = tokens[index];
    onSelect(token);
    setAnnouncement(`VeggieMeet avatar ${index + 1} of ${tokens.length} selected`);
  }

  function move(index: number) {
    const next = (index + tokens.length) % tokens.length;
    shouldFocus.current = true;
    setFocusIndex(next);
    select(next);
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(index - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(tokens.length - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        select(index);
        break;
      default:
        break;
    }
  }

  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-label="VeggieMeet avatars"
        className="grid grid-cols-4 gap-3"
      >
        {PLATFORM_AVATARS.map((asset, i) => {
          const token = tokens[i];
          const selected = token === current;
          return (
            <button
              key={token}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`VeggieMeet avatar ${i + 1}${selected ? " (current)" : ""}`}
              tabIndex={i === (focusIndex ?? currentIndex) ? 0 : -1}
              onFocus={() => setFocusIndex(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onClick={() => select(i)}
              className={cn(
                "relative rounded-full overflow-hidden aspect-square transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "ring-1 ring-border hover:ring-primary/60",
              )}
            >
              <img
                src={asset}
                alt=""
                loading="lazy"
                width={512}
                height={512}
                className="w-full h-full object-cover"
              />
            </button>
          );
        })}
      </div>
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

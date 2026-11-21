import type { ReactNode } from "react";
import { formatCardDate } from "@/lib/collection";
import { cn } from "@/lib/utils";

/**
 * A framed memory card: photo with the meetup title, date and place printed on
 * the frame (STIKKA "frame your photos with the place's name"). Used for both
 * the small grid tile (thumb) and the full-size view (photo).
 */
export function MemoryCardFrame({
  src,
  title,
  date,
  placeLabel,
  caption,
  hidden = false,
  onClick,
  className,
  imgClassName,
}: {
  src: string;
  title: string;
  date: string;
  placeLabel: string | null;
  caption?: string;
  hidden?: boolean;
  onClick?: () => void;
  className?: string;
  imgClassName?: string;
}) {
  const body: ReactNode = (
    <>
      <div className={cn("relative rounded-[10px] overflow-hidden bg-muted aspect-[4/5]", imgClassName)}>
        <img src={src} alt={title} className="w-full h-full object-cover" loading="lazy" draggable={false} />
        {hidden && (
          <span className="absolute top-1.5 right-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background/90 text-charcoal-muted">
            Hidden
          </span>
        )}
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-[12px] font-semibold text-charcoal leading-tight line-clamp-1">{title}</div>
        <div className="text-[10px] text-charcoal-muted leading-tight line-clamp-1">
          {formatCardDate(date)}
          {placeLabel ? ` · ${placeLabel}` : ""}
        </div>
        {caption && <div className="mt-1 text-[11px] text-charcoal leading-snug line-clamp-2">{caption}</div>}
      </div>
    </>
  );

  const frame = "block w-full text-left rounded-card bg-card border border-border shadow-soft p-2 pb-2.5";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          frame,
          "transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          className,
        )}
      >
        {body}
      </button>
    );
  }
  return <div className={cn(frame, className)}>{body}</div>;
}

export default MemoryCardFrame;

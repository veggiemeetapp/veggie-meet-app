import { safeBack } from "@/lib/navigation";
import { BackButton } from "@/components/app";
import { Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { createShareGuard, shareOrCopy } from "@/lib/share";
import { ProgressiveImage } from "@/components/app/ProgressiveImage";
import { FALLBACK_COVER } from "@/lib/backend";

interface Props {
  imageUrl?: string;
  title: string;
  extraAction?: ReactNode;
  /** WO-115 — canonical Meetup URL. When absent the Share affordance is hidden. */
  shareUrl?: string;
  shareMeta?: Record<string, string>;
}

export function MeetupHero({ imageUrl, title, extraAction, shareUrl, shareMeta }: Props) {
  const navigate = useNavigate();
  const hasImage = Boolean(imageUrl);
  const guard = useMemo(() => createShareGuard(), []);
  const roundBtn = cn(
    "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
    hasImage
      ? "bg-background/90 backdrop-blur text-charcoal hover:bg-background"
      : "bg-secondary text-charcoal hover:bg-accent",
  );

  const onShare = () =>
    guard(() =>
      shareOrCopy({
        title: `${title} | VeggieMeet`,
        text: `Join me at ${title} on VeggieMeet.`,
        url: shareUrl!,
        copiedMessage: "Meetup link copied",
        errorMessage: "Couldn’t share this Meetup. Please try again.",
        analyticsEvent: "meetup_share",
        analyticsMeta: shareMeta,
      }),
    );

  return (
    <div className={cn("relative", hasImage ? "h-72" : "h-16")}>

      {hasImage && (
        <>
          <ProgressiveImage
            src={imageUrl}
            fallbackSrc={FALLBACK_COVER}
            alt={title}
            containerClassName="absolute inset-0"
          />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/20 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/40 to-transparent pointer-events-none" />
        </>
      )}
      <div className="safe-top absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3">
        <BackButton fallback="/community" />
        <div className="flex items-center gap-2">
          {shareUrl ? (
            <button
              type="button"
              aria-label="Share Meetup"
              onClick={onShare}
              className={cn(roundBtn, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")}
            >
              <Share2 className="w-4 h-4" aria-hidden />
            </button>
          ) : null}

          {extraAction ? (
            <div className={cn(roundBtn, "p-0")}>{extraAction}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


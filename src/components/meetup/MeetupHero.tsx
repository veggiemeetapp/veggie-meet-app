import { ArrowLeft, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  imageUrl?: string;
  title: string;
  extraAction?: ReactNode;
}

export function MeetupHero({ imageUrl, title, extraAction }: Props) {
  const navigate = useNavigate();
  const hasImage = Boolean(imageUrl);
  const roundBtn = cn(
    "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
    hasImage
      ? "bg-background/90 backdrop-blur text-charcoal hover:bg-background"
      : "bg-secondary text-charcoal hover:bg-accent",
  );

  return (
    <div className={cn("relative", hasImage ? "h-72" : "h-16")}>
      {hasImage && (
        <>
          <img
            src={imageUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover bg-muted"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.includes("photo-1543353071")) {
                img.src =
                  "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80";
              }
            }}
          />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/20 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/40 to-transparent pointer-events-none" />
        </>
      )}
      <div className="safe-top absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className={roundBtn}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <button aria-label="Share" className={roundBtn}>
            <Share2 className="w-4 h-4" />
          </button>
          {extraAction ? (
            <div className={cn(roundBtn, "p-0")}>{extraAction}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


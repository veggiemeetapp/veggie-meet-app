import type { ReactNode } from "react";
import { CalendarDays, Clock3, MapPin } from "lucide-react";
import { ProgressiveImage } from "@/components/app/ProgressiveImage";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface MeetupMapSheetContentProps {
  title: string;
  dateLabel: string;
  timeLabel: string;
  locationLabel: string;
  glyph: string;
  coverImageUrl: string | null;
  prototype?: boolean;
  action?: ReactNode;
}

export function MeetupMapSheetContent({
  title,
  dateLabel,
  timeLabel,
  locationLabel,
  glyph,
  coverImageUrl,
  prototype = false,
  action,
}: MeetupMapSheetContentProps) {
  const fallback = (
    <span className="grid h-full w-full place-items-center bg-primary-soft text-5xl" aria-hidden="true">
      {glyph || "🌱"}
    </span>
  );

  return (
    <div className="space-y-5">
      {coverImageUrl ? (
        <ProgressiveImage
          src={coverImageUrl}
          alt={`${title} cover`}
          fallback={fallback}
          containerClassName="aspect-[16/7] max-h-44 w-full rounded-card border-2 border-card shadow-lg ring-1 ring-border"
          imageClassName="object-cover object-center"
        />
      ) : (
        <span className="block aspect-[16/7] max-h-44 w-full overflow-hidden rounded-card border-2 border-card shadow-lg ring-1 ring-border">
          {fallback}
        </span>
      )}

      <div className="space-y-4">
        <SheetHeader className="space-y-2 pr-8 text-left">
          {prototype ? (
            <span className="w-fit rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
              Prototype data
            </span>
          ) : null}
          <SheetTitle className="text-xl leading-snug sm:text-2xl">{title}</SheetTitle>
        </SheetHeader>

        <dl className="grid gap-2.5 text-sm text-charcoal-muted">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <dt className="sr-only">Date</dt>
            <dd>{dateLabel}</dd>
          </div>
          <div className="flex items-center gap-3">
            <Clock3 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <dt className="sr-only">Time</dt>
            <dd>{timeLabel}</dd>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <dt className="sr-only">Location</dt>
            <dd className="min-w-0 break-words">{locationLabel}</dd>
          </div>
        </dl>

        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}
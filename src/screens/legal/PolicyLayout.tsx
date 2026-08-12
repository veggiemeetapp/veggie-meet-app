import { ReactNode } from "react";
import { BackButton } from "@/components/app";

/**
 * WO-099 — shared reading layout for VeggieMeet's member-facing trust
 * documents (/privacy, /terms, /community-guidelines).
 *
 * Deliberately plain: no marketing chrome, no markdown runtime, no CMS. The
 * documents are static components so they load instantly, remain selectable
 * and copyable, and stay readable at 320px and 200% text.
 *
 * These routes are intentionally PUBLIC (mounted outside the auth gate) — a
 * visitor must be able to read them before creating an account.
 */
export function PolicyLayout({
  title,
  intro,
  /** Only pass a real, owner-approved date. Never today's date for drafts. */
  lastUpdated,
  status,
  children,
}: {
  title: string;
  intro?: string;
  lastUpdated?: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="px-5 pt-4 pb-3 border-b border-border/60">
        <BackButton fallback="/" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-charcoal">
          {title}
        </h1>
        {intro && (
          <p className="mt-2 text-sm text-charcoal-muted leading-relaxed">{intro}</p>
        )}
        {lastUpdated && (
          <p className="mt-2 text-xs text-charcoal-muted">Last updated {lastUpdated}</p>
        )}
      </header>

      <div className="px-5 py-6 pb-16 space-y-6 max-w-[68ch] w-full mx-auto">
        {status}
        {children}
      </div>
    </div>
  );
}

export function PolicySection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-charcoal">{heading}</h2>
      <div className="space-y-2 text-sm text-charcoal leading-relaxed [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:break-words">
        {children}
      </div>
    </section>
  );
}

/**
 * Honest draft banner. Used where final owner-approved / legally reviewed copy
 * does not yet exist, so nothing on the page can be mistaken for a final,
 * binding document.
 */
export function DraftNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="rounded-card border border-warning-border bg-warning-soft p-4 text-sm text-warning-foreground leading-relaxed"
    >
      {children}
    </div>
  );
}

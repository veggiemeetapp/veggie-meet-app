import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, ShieldCheck } from "lucide-react";
import { AppHeader, Card } from "@/components/app";
import { Button } from "@/components/ui/button";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  fetchMyPlaceReports,
  REPORT_REASON_LABEL,
  REPORT_STATUS_HINT,
  REPORT_STATUS_LABEL,
  type PlaceReportStatus,
} from "@/lib/placeReports";

/** Status chips pair colour with an explicit label, never colour alone. */
const STATUS_STYLE: Record<PlaceReportStatus, string> = {
  pending: "bg-muted text-charcoal-muted",
  under_review: "bg-soft-green text-primary",
  resolved: "bg-soft-green text-primary",
  dismissed: "bg-muted text-charcoal-muted",
  duplicate: "bg-muted text-charcoal-muted",
};

export default function MyPlaceReports() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get("report");
  const source = params.get("from") ?? "direct";
  const q = useQuery({ queryKey: ["my-place-reports"], queryFn: fetchMyPlaceReports });
  const focusRef = useRef<HTMLLIElement | null>(null);
  const loggedRef = useRef(false);

  useEffect(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    logAnalyticsEvent("community_place_report_history_opened", { source });
  }, [source]);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  // Only the signed-in member's own reports are ever returned, so an unknown
  // focus id simply falls back to the plain history view.
  const focusedExists = !!focusId && rows.some((r) => r.id === focusId);

  useEffect(() => {
    if (!focusedExists) return;
    const node = focusRef.current;
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.focus({ preventScroll: true });
  }, [focusedExists]);

  return (
    <>
      <AppHeader
        left={
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="w-9 h-9 -ml-1 rounded-full inline-flex items-center justify-center hover:bg-muted/60 text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </button>
        }
        title="My place reports"
      />

      <div className="px-5 pt-4 pb-24 animate-fade-in">
        <div className="mx-auto w-full min-w-0 max-w-xl">
          <p className="text-sm text-charcoal-muted">
            Reports are private. Our team reviews each one before anything about a place changes.
          </p>

          {q.isPending ? (
            <div className="mt-5 space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border/70 px-5 py-10 text-center">
              <ShieldCheck className="mx-auto h-7 w-7 text-primary/70" aria-hidden />
              <h2 className="mt-3 text-base font-semibold text-charcoal">No reports yet</h2>
              <p className="mt-1 text-sm text-charcoal-muted">
                Spotted something out of date at a Community Place? Let us know from its page.
              </p>
              <Button className="mt-5" asChild>
                <Link to="/community/places">Browse Community Places</Link>
              </Button>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {rows.map((r) => {
                const focused = focusedExists && r.id === focusId;
                return (
                  <li
                    key={r.id}
                    ref={focused ? focusRef : undefined}
                    tabIndex={focused ? -1 : undefined}
                    aria-current={focused ? "true" : undefined}
                    className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Card className={focused ? "ring-2 ring-primary/40" : undefined}>
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-charcoal line-clamp-2 [overflow-wrap:anywhere]">
                            {r.place_name}
                          </h2>
                          <p className="mt-1 text-xs text-charcoal-muted [overflow-wrap:anywhere]">
                            {REPORT_REASON_LABEL[r.reason_code] ?? "Reported issue"}
                          </p>
                          <p className="mt-1 text-xs text-charcoal-muted flex items-center gap-1.5">
                            <Clock className="h-3 w-3 shrink-0" aria-hidden />
                            {new Date(r.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status]}`}
                        >
                          {REPORT_STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-charcoal-muted">
                        {REPORT_STATUS_HINT[r.status]}
                      </p>
                      <Link
                        to={`/place/${r.community_place_id}`}
                        className="mt-2 inline-block text-xs font-semibold text-primary"
                      >
                        View place
                      </Link>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

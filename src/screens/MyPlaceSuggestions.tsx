import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, Leaf } from "lucide-react";
import { AppHeader, Card, BackButton } from "@/components/app";
import { Button } from "@/components/ui/button";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  fetchMyPlaceSuggestions,
  USER_STATUS_HINT,
  USER_STATUS_LABEL,
  type SuggestionStatus,
} from "@/lib/placeSuggestions";

/** Status chips pair colour with an explicit label, never colour alone. */
const STATUS_STYLE: Record<SuggestionStatus, string> = {
  pending: "bg-muted text-charcoal-muted",
  under_review: "bg-soft-green text-primary",
  approved: "bg-soft-green text-primary",
  rejected: "bg-muted text-charcoal-muted",
  duplicate: "bg-muted text-charcoal-muted",
};

export default function MyPlaceSuggestions() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get("suggestion");
  const source = params.get("from") ?? "direct";
  const q = useQuery({ queryKey: ["my-place-suggestions"], queryFn: fetchMyPlaceSuggestions });
  const focusRef = useRef<HTMLLIElement | null>(null);
  const loggedRef = useRef(false);

  useEffect(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    logAnalyticsEvent("place_suggestion_history_opened", { source });
  }, [source]);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  // Only the signed-in user's own suggestions are ever returned, so a focus id
  // that isn't in this list simply falls back to the plain history view.
  const focusedExists = !!focusId && rows.some((s) => s.id === focusId);

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
          <BackButton fallback="/you" />
        }
        title="My place suggestions"
      />

      <div className="px-5 pt-4 pb-24 animate-fade-in">
        <div className="mx-auto w-full max-w-xl">
          <p className="text-sm text-charcoal-muted">
            Every suggestion is reviewed before it can appear in VeggieMeet.
          </p>

          {q.isPending ? (
            <div className="mt-5 space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border/70 px-5 py-10 text-center">
              <Leaf className="mx-auto h-7 w-7 text-primary/70" aria-hidden />
              <h2 className="mt-3 text-base font-semibold text-charcoal">No suggestions yet</h2>
              <p className="mt-1 text-sm text-charcoal-muted">
                Know a 100% vegan place? Tell us about it.
              </p>
              <Button className="mt-5" asChild>
                <Link to="/community/places/suggest">Suggest a Place</Link>
              </Button>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {rows.map((s) => {
                const focused = focusedExists && s.id === focusId;
                return (
                  <li
                    key={s.id}
                    ref={focused ? focusRef : undefined}
                    tabIndex={focused ? -1 : undefined}
                    aria-current={focused ? "true" : undefined}
                    className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Card className={focused ? "ring-2 ring-primary/40" : undefined}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-charcoal break-words">
                            {s.place_name}
                          </h2>
                          <p className="mt-1 text-xs text-charcoal-muted flex items-center gap-1.5">
                            <Clock className="h-3 w-3 shrink-0" aria-hidden />
                            {s.city_name ? `${s.city_name} · ` : ""}
                            {new Date(s.submitted_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s.status]}`}
                        >
                          {USER_STATUS_LABEL[s.status]}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-charcoal-muted">
                        {USER_STATUS_HINT[s.status]}
                      </p>
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
